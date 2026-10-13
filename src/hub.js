// -----------------------------------------------------------------------------
// The NAS hub: reads the NAS on a timer of the container (the interval chosen
// in the configuration, one minute at most often), publishes the states of the
// devices the user added when they change, fires the scene events on
// transitions (src/alerts.js), and serves the views of the widget and of the
// "Test the connection" action.
//
// Gladys never polls these devices (should_poll: false): the configurable
// interval goes up to 5 minutes, beyond the fixed list of the core scheduler,
// and the scene events must fire for every volume and disk, added to Gladys
// or not.
//
// The 300 states per minute of Gladys: about thirty features at most, read
// once a minute, and only what changed is sent (publishChangedStates of the
// SDK); every value is sent again after 6 hours unchanged, before the core
// marks it outdated.
//
// Logs stay quiet: a normal read writes at the debug level only, and a failure
// that repeats on every read (Gladys refusing the states, a NAS that stays
// silent) writes one line when it starts and one when it ends.
//
// A refused password is never retried on the timer: UGOS blocks an address
// after a few failed logins. Saving the configuration, "Test the connection"
// or the Refresh button of the widget try again.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { Watcher } from './alerts.js';
import { hostOf, isComplete } from './config.js';
import { DEVICE_TYPES, buildDevice, deviceIds, deviceStates } from './devices.js';
import { ERROR_KINDS, UgosClient } from './ugos/client.js';
import { parseSnapshot } from './ugos/model.js';
import {
  CONNECTION_TEXT,
  DISK_STATE_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  VOLUME_STATE_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'ugreen-hub' });

export const WIDGET_KEY = 'nas';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  VOLUME: 'volume_degraded',
  DISK: 'disk_alert',
  UNREACHABLE: 'nas_unreachable',
});

export const HUB_TIMINGS = {
  // A NAS that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the NAS counts as unreachable (scene event).
  downAfterFailures: 2,
  // An unchanged value is sent again after this long.
  heartbeatMs: 6 * 3600_000,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;
// The errors that wait for the user instead of being retried on the timer.
const BLOCKING = new Set([ERROR_KINDS.AUTH, ERROR_KINDS.OTP]);

const signature = (config) =>
  JSON.stringify([config.url, config.username, config.password, config.language]);

export class NasHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/ugos/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.signature = null;
    this.client = null;
    this.watcher = new Watcher();
    this.resetRead();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.pollTimer = null;
    this.retryTimer = null;
    this.polling = null;
    this.stopped = false;
    /** The failures already logged, until they end (see failed/recovered). */
    this.failing = new Set();
  }

  resetRead() {
    /** @type {object|null} the last snapshot read (src/ugos/model.js) */
    this.snapshot = null;
    this.readAt = 0;
    this.error = null;
    this.failures = 0;
    this.down = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.watcher = new Watcher(await this.store.load());
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    this.signature = null; // a new login too
    await this.reconfigure(config, { force: true });
  }

  async reconfigure(config, { force = false } = {}) {
    const languageChanged = this.config?.language !== config.language;
    this.config = config;
    const wanted = isComplete(config) ? signature(config) : null;
    if (wanted !== this.signature) {
      this.signature = wanted;
      this.client = wanted
        ? new UgosClient({
            url: config.url,
            username: config.username,
            password: config.password,
            language: config.language,
            request: this.request,
          })
        : null;
      // Another address may be another NAS: nothing of the old one is kept.
      clearTimeout(this.retryTimer);
      this.resetRead();
    }
    if (languageChanged) {
      this.discovered = null;
    }
    if (this.client) {
      await this.poll({ manual: true });
    }
    await this.afterChanges(true, { publish: true, force });
    this.schedulePoll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.retryTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.afterChanges(await this.poll());
        this.recovered('poll');
      } catch (err) {
        this.failed('poll', 'Read cycle failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  // --- Names and identities ----------------------------------------------------

  /** The platform id of the NAS: its serial number, else something stable enough. */
  get nasId() {
    if (this.snapshot?.platformId) {
      return this.snapshot.platformId;
    }
    if (this.watcher.saved.nas) {
      return this.watcher.saved.nas;
    }
    return this.config?.url
      ? `h${createHash('sha1').update(this.config.url).digest('hex').slice(0, 12)}`
      : null;
  }

  /** The NAS name: the one set in UGOS, its model, or its address. */
  get nasName() {
    return (
      this.snapshot?.name ??
      this.snapshot?.model ??
      (this.config?.url ? hostOf(this.config.url) : 'UGREEN NAS')
    );
  }

  nasDeviceId() {
    return deviceIds(this.gladys, DEVICE_TYPES.NAS, this.nasId).device;
  }

  /** Every device the snapshot proposes: the NAS, its volumes, its disks. */
  items() {
    const { snapshot } = this;
    if (!snapshot) {
      return [];
    }
    const nas = this.nasName;
    return [
      { type: DEVICE_TYPES.NAS, key: null, name: nas, model: snapshot.model, item: snapshot },
      ...(snapshot.volumes ?? []).map((volume) => ({
        type: DEVICE_TYPES.VOLUME,
        key: volume.key,
        name: `${nas} ${volume.label}`,
        model: [volume.level, volume.filesystem].filter(Boolean).join(' · ') || 'Volume',
        item: volume,
      })),
      ...(snapshot.disks ?? []).map((disk) => ({
        type: DEVICE_TYPES.DISK,
        key: disk.key,
        name: `${nas} ${disk.label}`,
        model: disk.model ?? 'Disk',
        item: disk,
      })),
    ];
  }

  /** The created devices of this NAS, with what they stand for in the last read (null: gone). */
  createdDevices() {
    const nasId = this.nasId;
    if (!nasId) {
      return [];
    }
    const byId = new Map(
      this.items().map((entry) => [
        deviceIds(this.gladys, entry.type, nasId, entry.key).device,
        entry,
      ]),
    );
    const nasDevice = this.nasDeviceId();
    const created = [];
    for (const device of this.gladys.devices ?? []) {
      const entry = byId.get(device.external_id);
      if (entry) {
        created.push({ device, ...entry });
      } else if (device.external_id === nasDevice) {
        // The NAS before its first answer, or offline.
        created.push({ device, type: DEVICE_TYPES.NAS, key: null, item: null });
      }
    }
    return created;
  }

  isOurs(externalId) {
    return this.createdDevices().some(({ device }) => device.external_id === externalId);
  }

  // --- Devices -----------------------------------------------------------------

  discoveredDevices() {
    const nasId = this.nasId;
    return this.items().map((entry) =>
      buildDevice(this.gladys, { ...entry, nasId, language: this.config.language }),
    );
  }

  /** Publish the Discovery list when it changed (a disk added, a volume created…). */
  async publishDevices({ force = false } = {}) {
    if (!this.snapshot && !force) {
      return;
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    if (devices.length === 0 && this.discovered === null && !force) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.recovered('discovery');
    } catch (err) {
      this.failed('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the NAS, publish the list again. */
  async rediscover() {
    await this.poll({ manual: true });
    await this.afterChanges(true, { publish: true });
  }

  /** The user added (or updated) a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!this.isOurs(device.external_id)) {
      return;
    }
    // A device deleted then added again is a new row in Gladys: no badge yet.
    this.transports.delete(device.external_id);
    await this.publishStates({ force: true, only: device.external_id });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  onDeviceDeleted(device) {
    if (typeof device?.external_id === 'string') {
      this.transports.delete(device.external_id);
    }
  }

  // --- Reading the NAS -----------------------------------------------------------

  /**
   * Read the NAS and apply what changed. Concurrent calls share the read. A
   * refused login is only tried again on a manual request.
   * @returns {Promise<boolean>} whether the widget should be refreshed now
   */
  poll({ manual = false } = {}) {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!manual && this.error && BLOCKING.has(this.error.kind)) {
      return Promise.resolve(false);
    }
    const client = this.client;
    this.polling ??= this.read(client).finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  async read(client) {
    try {
      const raw = await client.read();
      return client === this.client ? await this.applySuccess(raw) : false;
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return client === this.client ? this.applyFailure(err) : false;
    }
  }

  async applySuccess(raw) {
    const snapshot = parseSnapshot(raw);
    logger.debug(
      `Read: ${snapshot.volumes?.length ?? 0} volume(s), ${snapshot.disks?.length ?? 0} disk(s)`,
    );
    const widgetChanged = this.error !== null || this.readAt === 0 || this.down;
    if (this.error || this.down) {
      logger.info(`${this.config.url ? hostOf(this.config.url) : 'NAS'} answers again`);
    }
    if (!this.snapshot) {
      const parts = Object.entries(snapshot.errors).map(([part, message]) => `${part}: ${message}`);
      logger.info(
        `Connected to ${snapshot.model ?? 'a UGREEN NAS'} (UGOS ${snapshot.version ?? '?'}), ` +
          `${snapshot.volumes?.length ?? 0} volume(s), ${snapshot.disks?.length ?? 0} disk(s)` +
          (parts.length ? `; not readable: ${parts.join(', ')}` : ''),
      );
    }
    this.snapshot = snapshot;
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.readAt = this.now();
    clearTimeout(this.retryTimer);

    this.watcher.bind(this.nasId);
    this.watcher.markReachable();
    let changed = widgetChanged;
    const language = this.config.language;
    const nasName = this.nasName;
    const nasId = this.nasId;
    for (const volume of this.watcher.volumes(snapshot.volumes)) {
      changed = true;
      logger.warn(`${nasName} ${volume.label}: ${volume.state}`);
      await this.fireEvent(TRIGGERS.VOLUME, {
        volume: deviceIds(this.gladys, DEVICE_TYPES.VOLUME, nasId, volume.key).device,
        nas_name: nasName,
        volume_name: volume.label,
        state: pick(VOLUME_STATE_TEXT[volume.state], language),
      });
    }
    for (const disk of this.watcher.disks(snapshot.disks)) {
      changed = true;
      logger.warn(`${nasName} ${disk.label}: ${disk.state}`);
      await this.fireEvent(TRIGGERS.DISK, {
        disk: deviceIds(this.gladys, DEVICE_TYPES.DISK, nasId, disk.key).device,
        nas_name: nasName,
        disk_name: disk.label,
        model: disk.model ?? '',
        state: pick(DISK_STATE_TEXT[disk.state], language),
        temperature: disk.temperature,
      });
    }
    this.store.save(this.watcher.saved);
    await this.publishStates();
    return changed;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`NAS: ${err.message}`);
    }
    // Only silence counts as unreachable: a refused password is a
    // configuration problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      this.failures = 0;
      return wasError !== err.kind;
    }
    this.failures += 1;
    if (this.failures === 1) {
      this.scheduleRetry();
    }
    if (!this.down && this.failures >= this.timings.downAfterFailures) {
      this.down = true;
      if (this.watcher.markUnreachable()) {
        this.store.save(this.watcher.saved);
        await this.fireEvent(TRIGGERS.UNREACHABLE, {
          nas_name: this.nasName,
          error: pick(ERROR_TEXT[err.kind], this.config.language),
        });
      }
      await this.publishStates();
      return true;
    }
    if (this.down) {
      await this.publishStates();
    }
    return wasError !== err.kind;
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.poll()
        .then((changed) => this.afterChanges(changed))
        .then(() => this.recovered('poll'))
        .catch((err) => this.failed('poll', 'Read cycle failed', err));
    }, this.timings.retryMs);
    this.retryTimer.unref?.();
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.recovered('scene event');
    } catch (err) {
      this.failed('scene event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  /**
   * A failure that may repeat on every read: logged when it starts, then at
   * the debug level only, until recovered() logs its end.
   */
  failed(key, message, err) {
    // An exception (err given) is a bug: error, with its stack.
    const first = err ? logger.error : logger.warn;
    const log = this.failing.has(key) ? logger.debug : first;
    this.failing.add(key);
    log(...(err ? [message, err] : [message]));
  }

  recovered(key) {
    if (this.failing.delete(key)) {
      logger.info(`${key}: back to normal`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /**
   * The states of the devices the user added.
   * @param {object} [options]
   * @param {boolean} [options.force] send even unchanged values (a device just added)
   * @param {string} [options.only] the external id of the one device to send
   */
  async publishStates({ force = false, only = null } = {}) {
    const nasId = this.nasId;
    const context = {
      online: this.error === null && this.snapshot !== null,
      language: this.config.language,
    };
    const states = [];
    for (const { device, type, key, item } of this.createdDevices()) {
      if (only && device.external_id !== only) {
        continue;
      }
      if (this.error || !this.snapshot) {
        // Nothing read: only say the NAS is offline once it is.
        if (type === DEVICE_TYPES.NAS && this.down) {
          states.push(
            ...deviceStates(this.gladys, { type, nasId, key, item: null, context }).filter(
              (state) => state.device_feature_external_id.endsWith(':online'),
            ),
          );
        }
        continue;
      }
      states.push(...deviceStates(this.gladys, { type, nasId, key, item, context }));
    }
    if (states.length === 0) {
      return;
    }
    try {
      if (force) {
        // Sent again even unchanged, and remembered for the next comparisons.
        this.gladys.forgetPublishedStates(only ?? undefined);
      }
      // Batches of 100 at most: done by the SDK.
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.recovered('states');
    } catch (err) {
      this.failed('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false, force = false } = {}) {
    await this.publishDevices({ force: publish });
    if (force) {
      await this.publishStates({ force: true });
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable". */
  async publishTransports() {
    if (this.readAt === 0) {
      return;
    }
    const transport = this.error === null ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    const entries = [];
    for (const { device } of this.createdDevices()) {
      if (this.transports.get(device.external_id) !== transport) {
        entries.push({ external_id: device.external_id, transport });
      }
    }
    let refused = false;
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
      } catch (err) {
        refused = true;
        this.failed('transports', `Transports refused: ${err.message}`);
      }
    }
    if (entries.length > 0 && !refused) {
      this.recovered('transports');
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config || !this.client) {
      return {
        connected: false,
        message: this.config?.addressInvalid
          ? CONNECTION_TEXT.invalidAddress
          : CONNECTION_TEXT.notConfigured,
      };
    }
    if (!this.error) {
      return { connected: this.snapshot !== null };
    }
    const message = {};
    for (const language of Object.keys(ERROR_TEXT[this.error.kind])) {
      message[language] = labelled(
        this.nasName,
        pick(ERROR_TEXT[this.error.kind], language),
        language,
      ).slice(0, 200);
    }
    return { connected: false, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.recovered('connection status');
    } catch (err) {
      this.failed('connection status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, test action) --------------------------------------------------

  /** What the widget shows of the NAS. */
  view() {
    return {
      configured: Boolean(this.client),
      name: this.nasName,
      online: this.error === null && this.snapshot !== null,
      error: this.error,
      snapshot: this.snapshot,
    };
  }

  /** "Test the connection": read the NAS now, one line. */
  async testConnection() {
    if (this.client) {
      await this.afterChanges(await this.poll({ manual: true }), { publish: true });
    }
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!this.client) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      if (this.error) {
        message[language] = labelled(
          this.nasName,
          pick(ERROR_TEXT[this.error.kind], language),
          language,
        );
        continue;
      }
      const { snapshot } = this;
      const parts = [
        `${text.ok}`,
        [snapshot.model, snapshot.version ? `UGOS ${snapshot.version}` : null]
          .filter(Boolean)
          .join(', '),
      ];
      if (snapshot.volumes === null && snapshot.disks === null) {
        parts.push(text.noStorage);
      } else {
        parts.push(
          text.volumes(snapshot.volumes?.length ?? 0),
          text.disks(snapshot.disks?.length ?? 0),
        );
      }
      message[language] = labelled(this.nasName, parts.filter(Boolean).join(', '), language).slice(
        0,
        200,
      );
    }
    return message;
  }
}
