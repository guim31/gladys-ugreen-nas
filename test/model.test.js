// -----------------------------------------------------------------------------
// The snapshot read from the UGOS answers (src/ugos/model.js): the figures of
// the fixtures, the state codes of the web interface, and what a firmware may
// send differently (numbers as strings, a sensor at 0, no serial number).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diskState, itemKey, num, parseSnapshot, volumeState } from '../src/ugos/model.js';
import { readFixture } from './helpers/fakeUgos.js';

const fixtures = () => ({
  machine: readFixture('machine-common.json').data,
  stats: readFixture('stat-get_all.json').data,
  pools: readFixture('pool-list.json').data,
  disks: readFixture('disk-list.json').data,
  errors: {},
});

test('the NAS figures of the fixtures', () => {
  const snapshot = parseSnapshot(fixtures());
  assert.equal(snapshot.platformId, 'UGTEST00000001');
  assert.equal(snapshot.name, 'NASync');
  assert.equal(snapshot.model, 'DXP4800 Plus');
  assert.equal(snapshot.version, '1.9.0.0075');
  assert.equal(snapshot.uptime, 1058400);
  assert.equal(snapshot.cpu, 12.4);
  assert.equal(snapshot.memory, 38.27);
  assert.equal(snapshot.cpuTemperature, 46);
  assert.equal(snapshot.rx, 1250000);
  assert.equal(snapshot.tx, 250000);
});

test('the volumes of the fixtures, with their pool', () => {
  const { volumes } = parseSnapshot(fixtures());
  assert.deepEqual(
    volumes.map((volume) => [volume.key, volume.label, volume.pool, volume.state]),
    [
      ['volume1', 'Volume 1', 'pool1', 'normal'],
      ['volume2', 'Volume 2', 'pool2', 'normal'],
    ],
  );
  assert.equal(volumes[0].total, 3900000000000);
  assert.equal(volumes[0].free, 1443000000000);
  assert.equal(volumes[0].percent, 63);
  assert.equal(volumes[0].level, 'raid1');
});

test('the disks of the fixtures, keyed by serial number', () => {
  const { disks } = parseSnapshot(fixtures());
  assert.deepEqual(
    disks.map((disk) => [disk.key, disk.label, disk.temperature, disk.state]),
    [
      ['WD-TESTDISK0001', 'Disk 1', 36, 'normal'],
      ['WD-TESTDISK0002', 'Disk 2', 37, 'normal'],
      ['S6TESTNVME0001', 'M.2 Drive 1', 41, 'normal'],
    ],
  );
});

test('a volume takes the worse state of itself and its pool', () => {
  assert.equal(volumeState(0, 0), 'normal');
  assert.equal(volumeState(1, 0), 'rebuilding');
  assert.equal(volumeState(2, 0), 'degraded');
  assert.equal(volumeState(3, 0), 'faulty');
  assert.equal(volumeState(0, 1), 'warning');
  assert.equal(volumeState(0, 2), 'degraded');
  assert.equal(volumeState(1, 3), 'faulty');
  assert.equal(volumeState(1, 1), 'rebuilding');
  // Unknown codes are never an alert; a known one still counts.
  assert.equal(volumeState(9, undefined), 'unknown');
  assert.equal(volumeState(9, 2), 'degraded');
  assert.equal(volumeState('2', null), 'degraded');
});

test('the disk codes of the web interface', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, null, '3'].map(diskState), [
    'undetectable',
    'normal',
    'warning',
    'critical',
    'failing',
    'locked',
    'unknown',
    'unknown',
    'critical',
  ]);
});

test('numbers as strings, sensors at 0, missing parts', () => {
  const read = fixtures();
  read.stats.overview.mem[0].used_percent = '28,8';
  read.stats.overview.cpu[0].temp = 0;
  read.machine.hardware.cpu[0].temperature = 0;
  read.disks.result[0].temperature = 0;
  delete read.stats.overview.net;
  const snapshot = parseSnapshot(read);
  assert.equal(snapshot.memory, 28.8);
  assert.equal(snapshot.cpuTemperature, null);
  assert.equal(snapshot.disks[0].temperature, null);
  assert.equal(snapshot.rx, null);

  const bare = parseSnapshot({ machine: read.machine, stats: null, pools: null, disks: null });
  assert.equal(bare.cpu, null);
  assert.equal(bare.volumes, null);
  assert.equal(bare.disks, null);
  // The CPU temperature of the hardware list, when the statistics have none.
  read.machine.hardware.cpu[0].temperature = 51;
  assert.equal(parseSnapshot({ ...read, stats: null }).cpuTemperature, 51);
});

test('the statistics of stat/overview sit at the root of data', () => {
  const read = fixtures();
  read.stats = read.stats.overview;
  assert.equal(parseSnapshot(read).cpu, 12.4);
});

test('without a serial number, the MAC address identifies the NAS', () => {
  const read = fixtures();
  read.machine.common.serial = '';
  assert.equal(parseSnapshot(read).platformId, '02005e000001');
  read.machine.common.serial = '********';
  assert.equal(parseSnapshot(read).platformId, '02005e000001');
  read.machine.common.mac = [];
  read.machine.hardware.net = [];
  assert.equal(parseSnapshot(read).platformId, null);
});

test('a disk without serial number keeps a stable key; odd names are hashed', () => {
  const read = fixtures();
  delete read.disks.result[2].serial;
  assert.equal(parseSnapshot(read).disks[2].key, 'dev-nvme0n1');
  assert.equal(itemKey('volume1'), 'volume1');
  assert.match(itemKey('Volume 1 (SSD)'), /^h[0-9a-f]{12}$/);
  assert.equal(itemKey('Volume 1 (SSD)'), itemKey('Volume 1 (SSD)'));
  assert.equal(num('12.5'), 12.5);
  assert.equal(num('n/a'), null);
});
