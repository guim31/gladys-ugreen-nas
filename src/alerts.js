// -----------------------------------------------------------------------------
// What the scene triggers compare with, read after read: the state of every
// volume and disk, and whether the NAS was announced unreachable. Pure
// bookkeeping, no I/O: the hub (src/hub.js) feeds it every read and fires the
// events it returns. The tables live in /data (src/store.js) so a restart
// neither repeats an announcement nor misses one.
//
//   - a volume (or its pool) or a disk is announced when its state needs
//     attention and is worse than the one recorded: healthy -> degraded fires,
//     degraded -> rebuilding does not (it is getting better), rebuilding ->
//     faulty fires again. Back to healthy re-arms it;
//   - the NAS is announced unreachable once, until it answers again.
//
// The first time an item is seen, its state is recorded without any event:
// nothing has changed, and no scene could exist yet at the very first read.
// The tables are those of one NAS: another serial number starts them afresh.
// -----------------------------------------------------------------------------

import { DISK_STATES, VOLUME_STATES } from './ugos/model.js';

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export class Watcher {
  constructor(saved = {}) {
    const tables = object(saved);
    this.saved = {
      nas: typeof tables.nas === 'string' ? tables.nas : null,
      volumes: object(tables.volumes),
      disks: object(tables.disks),
      unreachable: tables.unreachable === true,
    };
  }

  /** Bind the tables to a NAS; returns whether they were reset. */
  bind(nasId) {
    if (this.saved.nas === nasId) {
      return false;
    }
    const first = this.saved.nas === null;
    this.saved = {
      nas: nasId,
      volumes: {},
      disks: {},
      unreachable: first && this.saved.unreachable,
    };
    return true;
  }

  static transitions(table, items, states) {
    const events = [];
    for (const item of items) {
      const previous = table[item.key];
      table[item.key] = item.state;
      if (previous === undefined || !states[previous]) {
        continue;
      }
      const now = states[item.state];
      if (now.alert && now.severity > states[previous].severity) {
        events.push(item);
      }
    }
    return events;
  }

  /** @returns {Array<object>} the volumes whose state just got worse */
  volumes(volumes) {
    return Watcher.transitions(this.saved.volumes, volumes ?? [], VOLUME_STATES);
  }

  /** @returns {Array<object>} the disks whose state just got worse */
  disks(disks) {
    return Watcher.transitions(this.saved.disks, disks ?? [], DISK_STATES);
  }

  /** The NAS stopped answering; returns whether it is news. */
  markUnreachable() {
    if (this.saved.unreachable) {
      return false;
    }
    this.saved.unreachable = true;
    return true;
  }

  /** The NAS answers; returns whether it was announced unreachable. */
  markReachable() {
    const was = this.saved.unreachable;
    this.saved.unreachable = false;
    return was;
  }
}
