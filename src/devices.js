// -----------------------------------------------------------------------------
// The Gladys devices of a UGREEN NAS, proposed in the Discovery tab: the user
// adds the ones to follow, nothing is created on their behalf.
//
//   - the NAS itself: online, CPU, memory, CPU temperature, download and
//     upload rates, uptime, UGOS version;
//   - one device per volume: space used, capacity, free space, state, alert;
//   - one device per disk: temperature, state, alert.
//
// Identity: the serial number of the NAS (its MAC address when the firmware
// hides the serial), then the volume name UGOS gives (`volume1`) or the serial
// number of the disk. Never a label: UGOS translates its labels.
//
// Category/type couples come from the core table (see
// test/gladys-rules.test.js). The core has no generic "percent" category:
// usage percentages are `level-sensor/liquid-level-percent` (a fill level,
// the couple guim31/gladys-glances, OctoPrint and Brother already use), which
// also gives the gauge a 0-100 range. The states are `text/text` words in the
// configured language, next to an `input/binary` alert (1 = needs attention)
// that scenes and history can use.
//
// Published with should_poll: false: the integration reads the NAS on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { DISK_STATES, VOLUME_STATES } from './ugos/model.js';
import { DISK_STATE_TEXT, VOLUME_STATE_TEXT, pick } from './texts.js';

export const DEVICE_TYPES = Object.freeze({
  NAS: 'nas',
  VOLUME: 'volume',
  DISK: 'disk',
});

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  CPU: 'cpu',
  MEMORY: 'memory',
  CPU_TEMPERATURE: 'cpu_temperature',
  DOWNLOAD: 'download',
  UPLOAD: 'upload',
  UPTIME: 'uptime',
  VERSION: 'version',
  USED_PERCENT: 'used_percent',
  CAPACITY: 'capacity',
  FREE: 'free',
  STATE: 'state',
  ALERT: 'alert',
  TEMPERATURE: 'temperature',
});

const K = FEATURE_KEYS;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [K.ONLINE]: 'Online',
    [K.CPU]: 'CPU',
    [K.MEMORY]: 'Memory',
    [K.CPU_TEMPERATURE]: 'CPU temperature',
    [K.DOWNLOAD]: 'Download',
    [K.UPLOAD]: 'Upload',
    [K.UPTIME]: 'Uptime',
    [K.VERSION]: 'UGOS version',
    [K.USED_PERCENT]: 'Space used',
    [K.CAPACITY]: 'Capacity',
    [K.FREE]: 'Free space',
    [K.STATE]: 'State',
    [K.ALERT]: 'Alert',
    [K.TEMPERATURE]: 'Temperature',
  },
  fr: {
    [K.ONLINE]: 'En ligne',
    [K.CPU]: 'Processeur',
    [K.MEMORY]: 'Mémoire',
    [K.CPU_TEMPERATURE]: 'Température du processeur',
    [K.DOWNLOAD]: 'Réception',
    [K.UPLOAD]: 'Émission',
    [K.UPTIME]: 'Durée de fonctionnement',
    [K.VERSION]: "Version d'UGOS",
    [K.USED_PERCENT]: 'Espace utilisé',
    [K.CAPACITY]: 'Capacité',
    [K.FREE]: 'Espace libre',
    [K.STATE]: 'État',
    [K.ALERT]: 'Alerte',
    [K.TEMPERATURE]: 'Température',
  },
  de: {
    [K.ONLINE]: 'Online',
    [K.CPU]: 'Prozessor',
    [K.MEMORY]: 'Arbeitsspeicher',
    [K.CPU_TEMPERATURE]: 'Prozessortemperatur',
    [K.DOWNLOAD]: 'Empfang',
    [K.UPLOAD]: 'Senden',
    [K.UPTIME]: 'Laufzeit',
    [K.VERSION]: 'UGOS-Version',
    [K.USED_PERCENT]: 'Belegter Speicher',
    [K.CAPACITY]: 'Kapazität',
    [K.FREE]: 'Freier Speicher',
    [K.STATE]: 'Zustand',
    [K.ALERT]: 'Warnung',
    [K.TEMPERATURE]: 'Temperatur',
  },
  es: {
    [K.ONLINE]: 'En línea',
    [K.CPU]: 'Procesador',
    [K.MEMORY]: 'Memoria',
    [K.CPU_TEMPERATURE]: 'Temperatura del procesador',
    [K.DOWNLOAD]: 'Recepción',
    [K.UPLOAD]: 'Envío',
    [K.UPTIME]: 'Tiempo en marcha',
    [K.VERSION]: 'Versión de UGOS',
    [K.USED_PERCENT]: 'Espacio usado',
    [K.CAPACITY]: 'Capacidad',
    [K.FREE]: 'Espacio libre',
    [K.STATE]: 'Estado',
    [K.ALERT]: 'Alerta',
    [K.TEMPERATURE]: 'Temperatura',
  },
};

// Display bounds (the core never applies them on write). Fixed: a bound that
// moves changes the device structure.
export const BOUNDS = Object.freeze({
  TEMPERATURE: [-50, 150],
  RATE_MAX_MBPS: 10000,
  UPTIME_MAX_DAYS: 36500,
  SIZE_MAX_GB: 1000000,
});

/** External ids of a device: the NAS (`key` null), or one of its volumes or disks. */
export function deviceIds(gladys, type, nasId, key = null) {
  return gladys.externalIds(type, key === null ? nasId : `${nasId}-${key}`);
}

const round = (value, digits) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const percent = () => ({
  definition: {
    category: CATEGORY.LEVEL_SENSOR,
    type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  digits: 1,
});
const binary = () => ({
  definition: { category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
  digits: 0,
});
const temperature = () => ({
  definition: {
    category: CATEGORY.DEVICE_TEMPERATURE_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.CELSIUS,
    min: BOUNDS.TEMPERATURE[0],
    max: BOUNDS.TEMPERATURE[1],
  },
  digits: 0,
});
const rate = () => ({
  definition: {
    category: CATEGORY.DATARATE,
    type: TYPE.DATARATE.RATE,
    unit: UNIT.MEGABITS_PER_SECOND,
    min: 0,
    max: BOUNDS.RATE_MAX_MBPS,
  },
  digits: 2,
});
const size = () => ({
  definition: {
    category: CATEGORY.DATA,
    type: TYPE.DATA.SIZE,
    unit: UNIT.GIGABYTE,
    min: 0,
    max: BOUNDS.SIZE_MAX_GB,
  },
  digits: 1,
});
// A text state: min/max are NOT NULL in the core, even for a text.
const text = () => ({
  definition: { category: CATEGORY.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
  text: true,
});

const toMbps = (bytesPerSecond) =>
  bytesPerSecond === null || bytesPerSecond === undefined ? null : (bytesPerSecond * 8) / 1e6;
const toGigabytes = (bytes) => (bytes === null || bytes === undefined ? null : bytes / 1e9);

/**
 * The features of each device type: which exist for an item, their shape,
 * and their value. `item` is what the device stands for (the snapshot for the
 * NAS, a volume, a disk), null when it is gone; `ctx` carries { online, language }.
 */
const BLUEPRINTS = {
  [DEVICE_TYPES.NAS]: [
    { key: K.ONLINE, ...binary(), value: (_, ctx) => (ctx.online ? 1 : 0) },
    { key: K.CPU, ...percent(), value: (s) => s?.cpu },
    { key: K.MEMORY, ...percent(), value: (s) => s?.memory },
    {
      key: K.CPU_TEMPERATURE,
      ...temperature(),
      when: (s) => s.cpuTemperature !== null,
      value: (s) => s?.cpuTemperature,
    },
    { key: K.DOWNLOAD, ...rate(), when: (s) => s.rx !== null, value: (s) => toMbps(s?.rx) },
    { key: K.UPLOAD, ...rate(), when: (s) => s.tx !== null, value: (s) => toMbps(s?.tx) },
    {
      key: K.UPTIME,
      definition: {
        category: CATEGORY.DURATION,
        type: TYPE.DURATION.DECIMAL,
        unit: UNIT.DAYS,
        min: 0,
        max: BOUNDS.UPTIME_MAX_DAYS,
      },
      digits: 2,
      value: (s) => (s?.uptime === null || s?.uptime === undefined ? null : s.uptime / 86400),
    },
    { key: K.VERSION, ...text(), value: (s) => s?.version },
  ],
  [DEVICE_TYPES.VOLUME]: [
    { key: K.USED_PERCENT, ...percent(), value: (v) => v?.percent },
    { key: K.CAPACITY, ...size(), value: (v) => toGigabytes(v?.total) },
    { key: K.FREE, ...size(), value: (v) => toGigabytes(v?.free) },
    {
      key: K.STATE,
      ...text(),
      value: (v, ctx) => (v ? pick(VOLUME_STATE_TEXT[v.state], ctx.language) : null),
    },
    {
      key: K.ALERT,
      ...binary(),
      value: (v) => (v ? (VOLUME_STATES[v.state].alert ? 1 : 0) : null),
    },
  ],
  [DEVICE_TYPES.DISK]: [
    {
      key: K.TEMPERATURE,
      ...temperature(),
      // Kept once seen: a disk asleep reports no temperature for a while.
      value: (d) => d?.temperature,
    },
    {
      key: K.STATE,
      ...text(),
      value: (d, ctx) => (d ? pick(DISK_STATE_TEXT[d.state], ctx.language) : null),
    },
    { key: K.ALERT, ...binary(), value: (d) => (d ? (DISK_STATES[d.state].alert ? 1 : 0) : null) },
  ],
};

const present = (feature, item) => !feature.when || item === null || feature.when(item);

/** The feature keys a device of this type has for this item. */
export const featureKeys = (type, item) =>
  BLUEPRINTS[type].filter((feature) => present(feature, item)).map((f) => f.key);

/**
 * The discovery payload of a device.
 * @param {object} gladys SDK client
 * @param {object} options
 * @param {string} options.type one of DEVICE_TYPES
 * @param {string} options.nasId platform id of the NAS
 * @param {string|null} options.key item key (null for the NAS)
 * @param {string} options.name device name
 * @param {string} options.model device model
 * @param {object} options.item what the device stands for
 * @param {string} [options.language] feature names language
 */
export function buildDevice(
  gladys,
  { type, nasId, key = null, name, model, item, language = 'en' },
) {
  const ids = deviceIds(gladys, type, nasId, key);
  const names = NAMES[language] ?? NAMES.en;
  const features = BLUEPRINTS[type]
    .filter((feature) => present(feature, item))
    .map((feature) => ({
      name: names[feature.key],
      external_id: ids.feature(feature.key),
      ...feature.definition,
      read_only: true,
      has_feedback: false,
      keep_history: !feature.text,
    }));
  return {
    name: name.slice(0, 255),
    external_id: ids.device,
    model: (model ?? 'UGREEN NAS').slice(0, 255),
    should_poll: false,
    features,
  };
}

/**
 * The states of every feature of a device, in the `publishStates` format;
 * the features without a value are left out.
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function deviceStates(gladys, { type, nasId, key = null, item, context }) {
  const ids = deviceIds(gladys, type, nasId, key);
  const states = [];
  for (const feature of BLUEPRINTS[type]) {
    if (item !== null && !present(feature, item)) {
      continue;
    }
    const raw = feature.value(item, context);
    const id = ids.feature(feature.key);
    if (feature.text) {
      // An empty text is ignored by the core: nothing to publish.
      if (typeof raw === 'string' && raw.trim()) {
        states.push({ device_feature_external_id: id, text: raw.slice(0, 255) });
      }
      continue;
    }
    const value = round(raw, feature.digits);
    if (value !== null) {
      states.push({ device_feature_external_id: id, state: value });
    }
  }
  return states;
}
