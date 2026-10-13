// -----------------------------------------------------------------------------
// The answers of UGOS Pro (src/ugos/client.js), turned into one plain
// snapshot the rest of the code reads: no envelope, no string numbers, no
// field that may or may not exist.
//
// Field names come from the projects that read this API on real NAS
// (Fracizz/ugnas-api, the UgosBridge documentation, and, read only, the
// GPL-3.0 projects metaneutrons/ugos-cli and Tom-Bom-badil/home-assistant_ugreen-nas):
//
//   sysinfo/machine/common  data.common.{nas_name, model, serial, mac,
//                           system_version, run_time (s)},
//                           data.hardware.cpu[0].temperature, data.hardware.net[].mac
//   taskmgr/stat/get_all    data.overview.{cpu[].used_percent, cpu[].temp,
//                           mem[].used_percent, net[].recv_rate, net[].send_rate (B/s)}
//                           (`overview` answers the same lists at the root of data)
//   storage/pool/list       data.result[].{name, label, level, status,
//                           volumes[].{name, label, status, total, used, available}}
//   v2/storage/disk/list    data.result[].{serial, label, model, size, slot,
//                           dev_name, status, temperature}
//
// The state codes are those of the UGOS web interface:
//   pool    0 normal, 1 rebuilding, 2 degraded, 3 faulty
//   volume  0 normal, 1 warning, 2 danger (reported as degraded), 3 faulty
//   disk    0 undetectable, 1 normal, 2 warning, 3 critical, 4 failing, 5 locked
// A code outside these lists is "unknown": shown, never alerted on.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = (value) => (Array.isArray(value) ? value : []);

/** A number, from a number or a numeric string; null otherwise. */
export function num(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const str = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The last sample of a series UGOS sends as a list. */
const last = (value) => {
  const items = list(value);
  return items.length ? object(items[items.length - 1]) : {};
};

const percent = (value) => {
  const n = num(value);
  return n === null ? null : Math.min(100, Math.max(0, n));
};

// A sensor reading 0 °C inside a NAS is a sensor that did not answer (a disk
// asleep, a firmware without the value).
const celsius = (value) => {
  const n = num(value);
  return n === null || n <= 0 || n > 200 ? null : n;
};

/** A platform id part from a name UGOS gives: as is when safe, hashed otherwise. */
export function itemKey(name) {
  const text = String(name ?? '');
  if (/^[A-Za-z0-9_.-]{1,64}$/.test(text) && !/^h[0-9a-f]{12}$/.test(text)) {
    return text;
  }
  return `h${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;
}

// --- States ---------------------------------------------------------------------

// Volume states, by increasing severity; `alert` marks the ones a scene hears.
export const VOLUME_STATES = Object.freeze({
  normal: { severity: 0, alert: false },
  unknown: { severity: 0, alert: false },
  warning: { severity: 1, alert: true },
  rebuilding: { severity: 2, alert: true },
  degraded: { severity: 3, alert: true },
  faulty: { severity: 4, alert: true },
});

export const DISK_STATES = Object.freeze({
  normal: { severity: 0, alert: false },
  unknown: { severity: 0, alert: false },
  undetectable: { severity: 0, alert: false },
  locked: { severity: 0, alert: false },
  warning: { severity: 1, alert: true },
  critical: { severity: 2, alert: true },
  failing: { severity: 3, alert: true },
});

const POOL_CODES = { 0: 'normal', 1: 'rebuilding', 2: 'degraded', 3: 'faulty' };
const VOLUME_CODES = { 0: 'normal', 1: 'warning', 2: 'degraded', 3: 'faulty' };
const DISK_CODES = {
  0: 'undetectable',
  1: 'normal',
  2: 'warning',
  3: 'critical',
  4: 'failing',
  5: 'locked',
};

const codeState = (codes, value) => {
  const n = num(value);
  return n !== null && Number.isInteger(n) && codes[n] ? codes[n] : 'unknown';
};

/** The state of a volume: the worse of its own and its pool's. */
export function volumeState(poolStatus, volumeStatus) {
  const states = [codeState(POOL_CODES, poolStatus), codeState(VOLUME_CODES, volumeStatus)];
  const known = states.filter((state) => state !== 'unknown');
  if (known.length === 0) {
    return 'unknown';
  }
  return known.reduce((worst, state) =>
    VOLUME_STATES[state].severity > VOLUME_STATES[worst].severity ? state : worst,
  );
}

export const diskState = (status) => codeState(DISK_CODES, status);

// --- Snapshot -------------------------------------------------------------------

const normalizeMac = (value) => {
  const text = str(value);
  if (!text) {
    return null;
  }
  const hex = text.toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length === 12 && !/^0+$/.test(hex) ? hex : null;
};

/** The unique id UGOS gives the NAS: its serial number, else the MAC of its first interface. */
function platformId(common, hardware) {
  const serial = str(common.serial);
  if (serial && !/^[-*]+$/.test(serial)) {
    return itemKey(serial);
  }
  const macs = [...list(common.mac), ...list(hardware.net).map((net) => object(net).mac)];
  for (const mac of macs) {
    const normalized = normalizeMac(mac);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function parseVolumes(pools) {
  const volumes = [];
  const seen = new Set();
  for (const rawPool of list(object(pools).result ?? pools)) {
    const pool = object(rawPool);
    list(pool.volumes).forEach((rawVolume, index) => {
      const volume = object(rawVolume);
      const name = str(volume.name) ?? `${str(pool.name) ?? 'pool'}-${index + 1}`;
      const key = itemKey(name);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const total = num(volume.total);
      const used = num(volume.used);
      const available = num(volume.available) ?? num(volume.free);
      const free =
        available !== null ? available : total !== null && used !== null ? total - used : null;
      volumes.push({
        key,
        name,
        label: str(volume.label) ?? name,
        pool: str(pool.name),
        poolLabel: str(pool.label) ?? str(pool.name),
        level: str(pool.level),
        filesystem: str(volume.filesystem),
        total,
        used,
        free: free === null ? null : Math.max(0, free),
        percent: total && used !== null ? percent((used / total) * 100) : null,
        state: volumeState(pool.status, volume.status),
      });
    });
  }
  return volumes;
}

function parseDisks(disks) {
  const result = [];
  const seen = new Set();
  for (const rawDisk of list(object(disks).result ?? disks)) {
    const disk = object(rawDisk);
    const serial = str(disk.serial);
    const slot = num(disk.slot);
    const fallback = str(disk.dev_name) ?? str(disk.name) ?? (slot !== null ? `slot${slot}` : null);
    const id = serial ?? (fallback ? `dev-${fallback}` : null);
    if (!id) {
      continue;
    }
    const key = itemKey(id);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      key,
      serial,
      label: str(disk.label) ?? str(disk.name) ?? fallback ?? serial,
      model: str(disk.model),
      size: num(disk.size),
      slot,
      temperature: celsius(disk.temperature),
      state: diskState(disk.status),
    });
  }
  return result;
}

/**
 * @param {{ machine: any, stats: any, pools: any, disks: any, errors?: object }} read
 */
export function parseSnapshot(read) {
  const machine = object(read.machine);
  const common = object(machine.common);
  const hardware = object(machine.hardware);
  const stats = object(read.stats);
  const overview = Object.keys(object(stats.overview)).length ? object(stats.overview) : stats;

  const cpu = last(overview.cpu);
  const memory = last(overview.mem);
  const net = last(overview.net);
  const hasNet = list(overview.net).length > 0;
  const uptime = num(common.run_time);

  return {
    platformId: platformId(common, hardware),
    name: str(common.nas_name),
    model: str(common.model),
    version: str(common.system_version),
    uptime: uptime === null || uptime < 0 ? null : uptime,
    cpu: percent(cpu.used_percent),
    memory: percent(memory.used_percent),
    cpuTemperature: celsius(cpu.temp) ?? celsius(object(list(hardware.cpu)[0]).temperature),
    rx: hasNet ? num(net.recv_rate) : null,
    tx: hasNet ? num(net.send_rate) : null,
    volumes: read.pools === null || read.pools === undefined ? null : parseVolumes(read.pools),
    disks: read.disks === null || read.disks === undefined ? null : parseDisks(read.disks),
    errors: { ...object(read.errors) },
  };
}
