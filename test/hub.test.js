// -----------------------------------------------------------------------------
// The hub end to end, on the SDK's fake Gladys and the fake NAS: discovery,
// states (only the changes, everything again when a device is added), scene
// events on transitions only, their memory across a restart, the NAS
// unreachable, a refused password never retried on the timer, the connection
// status and the transport badges.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEVICE_TYPES, FEATURE_KEYS } from '../src/devices.js';
import { TRIGGERS } from '../src/hub.js';
import { FakeUgos } from './helpers/fakeUgos.js';
import { CONFIG, createDevices, createWorld, deviceId, featureId, tick } from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);

test('discovery proposes the NAS, its volumes and its disks, nothing created', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => [device.name, device.model]),
    [
      ['NASync', 'DXP4800 Plus'],
      ['NASync Volume 1', 'raid1 · btrfs'],
      ['NASync Volume 2', 'basic · ext4'],
      ['NASync Disk 1', 'WDC WD40EFPX-68C6CN0'],
      ['NASync Disk 2', 'WDC WD40EFPX-68C6CN0'],
      ['NASync M.2 Drive 1', 'Samsung SSD 990 EVO 1TB'],
    ],
  );
  assert.ok(world.fake.discoveredDevices.every((device) => device.should_poll === false));
  assert.equal(world.fake.states.length, 0, 'nothing published before a device is added');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a device added gets all its states at once, then only the changes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const nas = world.fake.discoveredDevices[0];
  await world.fake.deviceCreated(nas);
  const first = world.fake.states.length;
  assert.equal(first, 8);
  assert.equal(world.fake.lastState(featureId(world.gladys, DEVICE_TYPES.NAS, null, 'cpu')), 12.4);
  assert.equal(
    world.fake.lastState(featureId(world.gladys, DEVICE_TYPES.NAS, null, FEATURE_KEYS.VERSION)),
    '1.9.0.0075',
  );

  await tick(world);
  assert.equal(world.fake.states.length, first, 'nothing changed: nothing sent');
  world.nas.setCpu(55.55);
  await tick(world);
  assert.deepEqual(world.fake.states.slice(first), [
    {
      device_feature_external_id: featureId(world.gladys, DEVICE_TYPES.NAS, null, 'cpu'),
      state: 55.6,
    },
  ]);
  // The devices not added are never published.
  assert.ok(world.fake.states.every((state) => state.device_feature_external_id.includes(':nas:')));
});

test('volume and disk states, in the configured language', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, language: 'fr' } });
  t.after(() => world.app.stop());
  await createDevices(world);
  const volumeState = featureId(world.gladys, DEVICE_TYPES.VOLUME, 'volume1', FEATURE_KEYS.STATE);
  const volumeAlert = featureId(world.gladys, DEVICE_TYPES.VOLUME, 'volume1', FEATURE_KEYS.ALERT);
  assert.equal(world.fake.lastState(volumeState), 'Sain');
  assert.equal(world.fake.lastState(volumeAlert), 0);
  assert.equal(
    world.fake.lastState(featureId(world.gladys, DEVICE_TYPES.VOLUME, 'volume1', 'free')),
    1443,
  );
  world.nas.setPoolStatus('pool1', 2);
  world.nas.setDisk('WD-TESTDISK0002', { status: 3 });
  await tick(world);
  assert.equal(world.fake.lastState(volumeState), 'Dégradé');
  assert.equal(world.fake.lastState(volumeAlert), 1);
  assert.equal(
    world.fake.lastState(
      featureId(world.gladys, DEVICE_TYPES.DISK, 'WD-TESTDISK0002', FEATURE_KEYS.STATE),
    ),
    'Critique',
  );
});

test('volume degraded: on transitions only, worse again fires, better does not', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.fake.sceneEvents.length, 0, 'the first read only records');
  world.nas.setPoolStatus('pool1', 2);
  await tick(world);
  await tick(world);
  assert.deepEqual(events(world, TRIGGERS.VOLUME), [
    {
      key: TRIGGERS.VOLUME,
      data: {
        volume: deviceId(world.gladys, DEVICE_TYPES.VOLUME, 'volume1'),
        nas_name: 'NASync',
        volume_name: 'Volume 1',
        state: 'Degraded',
      },
    },
  ]);
  world.nas.setPoolStatus('pool1', 1); // rebuilding: getting better
  await tick(world);
  assert.equal(events(world, TRIGGERS.VOLUME).length, 1);
  world.nas.setPoolStatus('pool1', 3); // faulty: worse
  await tick(world);
  assert.equal(events(world, TRIGGERS.VOLUME).length, 2);
  assert.equal(events(world, TRIGGERS.VOLUME)[1].data.state, 'Faulty');
  world.nas.setPoolStatus('pool1', 0);
  await tick(world);
  world.nas.setVolumeStatus('volume1', 1);
  await tick(world);
  assert.equal(events(world, TRIGGERS.VOLUME).length, 3, 're-armed once healthy');
  assert.equal(events(world, TRIGGERS.VOLUME)[2].data.state, 'Warning');
});

test('disk alert, with its model and temperature; locked or unknown never alert', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, language: 'de' } });
  t.after(() => world.app.stop());
  world.nas.setDisk('WD-TESTDISK0001', { status: 5 });
  world.nas.setDisk('WD-TESTDISK0002', { status: 42 });
  await tick(world);
  assert.equal(events(world, TRIGGERS.DISK).length, 0);
  world.nas.setDisk('S6TESTNVME0001', { status: 2, temperature: 71 });
  await tick(world);
  assert.deepEqual(events(world, TRIGGERS.DISK), [
    {
      key: TRIGGERS.DISK,
      data: {
        disk: deviceId(world.gladys, DEVICE_TYPES.DISK, 'S6TESTNVME0001'),
        nas_name: 'NASync',
        disk_name: 'M.2 Drive 1',
        model: 'Samsung SSD 990 EVO 1TB',
        state: 'Warnung',
        temperature: 71,
      },
    },
  ]);
});

test('a restart neither repeats an event nor misses one', async () => {
  const first = await createWorld();
  first.nas.setPoolStatus('pool1', 2);
  await tick(first);
  await first.app.stop();
  assert.equal(events(first, TRIGGERS.VOLUME).length, 1);
  const saved = JSON.parse(await readFile(join(first.dataDir, 'ugreen-nas-state.json'), 'utf8'));
  assert.equal(saved.nas, 'UGTEST00000001');
  assert.equal(saved.volumes.volume1, 'degraded');

  // Same /data, same NAS still degraded: nothing new.
  const second = await createWorld({ nas: first.nas, dataDir: first.dataDir });
  assert.equal(events(second, TRIGGERS.VOLUME).length, 0);
  // Faulty while the integration was stopped: announced at the first read.
  await second.app.stop();
  first.nas.setPoolStatus('pool1', 3);
  const third = await createWorld({ nas: first.nas, dataDir: first.dataDir });
  assert.equal(events(third, TRIGGERS.VOLUME).length, 1);
  assert.equal(events(third, TRIGGERS.VOLUME)[0].data.state, 'Faulty');
  await third.app.stop();
});

test('another NAS behind the same /data starts its tables afresh', async () => {
  const first = await createWorld();
  await first.app.stop();
  const other = new FakeUgos();
  other.machine.data.common.serial = 'UGTEST00000002';
  other.setPoolStatus('pool1', 2);
  const second = await createWorld({ nas: other, dataDir: first.dataDir });
  assert.equal(events(second, TRIGGERS.VOLUME).length, 0, 'first sight of this NAS');
  await second.app.stop();
});

test('NAS unreachable: after two silent reads, once, and online goes to 0', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world, (device) => device.external_id.includes(':nas:'));
  const online = featureId(world.gladys, DEVICE_TYPES.NAS, null, FEATURE_KEYS.ONLINE);
  assert.equal(world.fake.lastState(online), 1);
  world.nas.failure = 'down';
  await tick(world);
  assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 0, 'one failure is a blip');
  assert.equal(world.fake.lastState(online), 1);
  await tick(world);
  await tick(world);
  assert.deepEqual(events(world, TRIGGERS.UNREACHABLE), [
    {
      key: TRIGGERS.UNREACHABLE,
      data: { nas_name: 'NASync', error: 'does not answer (is it on, is the address right?)' },
    },
  ]);
  assert.equal(world.fake.lastState(online), 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');

  world.nas.failure = null;
  await tick(world);
  assert.equal(world.fake.lastState(online), 1);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  world.nas.failure = 'down';
  await tick(world);
  await tick(world);
  assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 2, 're-armed once it answered');
});

test('a refused password waits for the user: no login on the timer', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, password: 'wrong-password' } });
  t.after(() => world.app.stop());
  assert.equal(world.nas.failedLogins, 1);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /password refused/);
  await tick(world);
  await tick(world);
  assert.equal(world.nas.failedLogins, 1, 'never retried on its own');
  assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 0);

  // "Test the connection" tries again; then the right password.
  await world.fake.action('test_connection');
  assert.equal(world.nas.failedLogins, 2);
  await world.fake.configUpdated(CONFIG);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(world.fake.discoveredDevices.length, 6);
});

test('an account with two-factor authentication says so', async (t) => {
  const world = await createWorld({ nas: new FakeUgos({ otp: true }) });
  t.after(() => world.app.stop());
  assert.match(world.fake.connectionStatus.message.fr, /double authentification/);
});

test('without configuration, the status says what to enter', async (t) => {
  const world = await createWorld({ config: {} });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /Enter the address/);
  assert.equal(world.network.calls.length, 0);
  await world.fake.configUpdated({ ...CONFIG, address: 'ftp://nas' });
  assert.match(world.fake.connectionStatus.message.en, /Address not understood/);
});

test('storage refused to the account: the NAS device still works', async (t) => {
  const world = await createWorld({ nas: new FakeUgos({ storage: false }) });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  const ack = await world.fake.action('test_connection');
  assert.match(ack.data.message.en, /storage not readable with this account/);
});

test('a volume gone keeps its device silent; a new disk is proposed', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const before = world.fake.states.length;
  world.nas.pools.data.result.pop();
  world.nas.disks.data.result.push({
    ...world.nas.disks.data.result[0],
    serial: 'WD-TESTDISK0003',
    label: 'Disk 3',
    slot: 3,
  });
  await tick(world);
  const names = world.fake.discoveredDevices.map((device) => device.name);
  assert.ok(!names.includes('NASync Volume 2'));
  assert.ok(names.includes('NASync Disk 3'));
  assert.ok(
    world.fake.states
      .slice(before)
      .every((state) => !state.device_feature_external_id.includes('volume2')),
  );
});

test('scan, poll and device update are served', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const nas = world.fake.discoveredDevices[0];
  await world.fake.deviceCreated(nas);
  await world.fake.scanRequest();
  assert.equal(world.fake.discoveredDevices.length, 6);
  const ack = await world.fake.poll(nas);
  assert.equal(ack.success, true);
  const before = world.fake.states.length;
  await world.fake.deviceUpdated(nas);
  assert.equal(world.fake.states.length - before, 8, 'everything again after an update');
  await world.fake.deviceDeleted(nas);
});

test('a language change renames the proposed features', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices[0].features[1].name, 'CPU');
  await world.fake.configUpdated({ ...CONFIG, language: 'es' });
  assert.equal(world.fake.discoveredDevices[0].features[1].name, 'Procesador');
});
