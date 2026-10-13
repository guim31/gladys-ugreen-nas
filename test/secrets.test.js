// -----------------------------------------------------------------------------
// The credentials never leave where they belong: the password stays in the
// Gladys configuration and in the login request (encrypted with the key of
// the NAS), the session token in memory and in the requests to the NAS. Not
// in the logs (at the most verbose level), not under /data, not in anything
// sent to Gladys — whatever happens: login, expired session, refused
// password, NAS gone, connection test.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WIDGET_KEY } from '../src/hub.js';
import { PASSWORD } from './helpers/fakeUgos.js';
import { CONFIG, createDevices, createWorld, tick } from './helpers/world.js';

/** Runs `fn` with every log line captured, at the debug level. */
async function captureLogs(fn) {
  const lines = [];
  const original = { log: console.log, error: console.error, level: process.env.LOG_LEVEL };
  process.env.LOG_LEVEL = 'debug';
  console.log = (...args) => lines.push(args.map(String).join(' '));
  console.error = (...args) => lines.push(args.map((a) => a?.stack ?? String(a)).join(' '));
  try {
    await fn();
  } finally {
    console.log = original.log;
    console.error = original.error;
    process.env.LOG_LEVEL = original.level;
  }
  return lines.join('\n');
}

test('neither the password nor a session token is logged, stored or sent to Gladys', async () => {
  let world;
  const tokens = new Set();
  const logs = await captureLogs(async () => {
    world = await createWorld();
    await createDevices(world);
    world.nas.expireTokens();
    await tick(world);
    world.nas.setPoolStatus('pool1', 2);
    await tick(world);
    await world.fake.action('test_connection');
    await world.fake.widgetGet(WIDGET_KEY, { language: 'fr' });
    world.nas.failure = 'down';
    await tick(world);
    await tick(world);
    world.nas.failure = null;
    await world.fake.configUpdated({ ...CONFIG, password: `${PASSWORD}-typo` });
    await world.fake.action('test_connection');
    await world.app.stop();
  });

  for (const request of world.nas.requests) {
    if (request.query.token) {
      tokens.add(request.query.token);
    }
  }
  const encrypted = world.nas.requests
    .filter((request) => request.path === '/ugreen/v1/verify/login')
    .map((request) => request.body.password);
  assert.ok(tokens.size >= 2, 'several sessions were opened');
  assert.ok(logs.length > 0, 'something was logged');

  const secrets = [PASSWORD, ...tokens, ...encrypted];
  const sentToGladys = JSON.stringify(world.fake.requests);
  const files = await readdir(world.dataDir);
  const stored = (
    await Promise.all(files.map((file) => readFile(join(world.dataDir, file), 'utf8')))
  ).join('\n');
  assert.ok(stored.includes('UGTEST00000001'), 'the state file was written');
  for (const secret of secrets) {
    assert.ok(!logs.includes(secret), 'a secret is in the logs');
    assert.ok(!sentToGladys.includes(secret), 'a secret was sent to Gladys');
    assert.ok(!stored.includes(secret), 'a secret is under /data');
  }
});
