// -----------------------------------------------------------------------------
// Configuration normalization: the address in every form a user types it, the
// defaults, the password kept as typed (but for a pasted line break).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  hostOf,
  isComplete,
  normalizeConfig,
  parseAddress,
} from '../src/config.js';

test('addresses: bare host on port 9999, explicit URL kept, path dropped', () => {
  assert.equal(parseAddress('192.0.2.50'), 'http://192.0.2.50:9999');
  assert.equal(parseAddress(' nas.lan '), 'http://nas.lan:9999');
  assert.equal(parseAddress('192.0.2.50:9443'), 'http://192.0.2.50:9443');
  assert.equal(parseAddress('http://192.0.2.50:9999/desktop/#/'), 'http://192.0.2.50:9999');
  assert.equal(parseAddress('https://192.0.2.50:9443'), 'https://192.0.2.50:9443');
  assert.equal(parseAddress('https://nas.lan'), 'https://nas.lan');
  assert.equal(parseAddress('[2001:db8::5]'), 'http://[2001:db8::5]:9999');
});

test('unusable addresses are refused', () => {
  for (const raw of [
    '',
    '   ',
    'ftp://nas.lan',
    'http://user:secret@nas.lan',
    'http://',
    null,
    42,
  ]) {
    assert.equal(parseAddress(raw), null, String(raw));
  }
});

test('defaults, and values outside the lists', () => {
  const config = normalizeConfig({});
  assert.equal(config.url, null);
  assert.equal(config.addressInvalid, false);
  assert.equal(config.pollIntervalMs, Number(DEFAULT_CONFIG.poll_interval) * 1000);
  assert.equal(config.language, DEFAULT_CONFIG.language);
  assert.equal(isComplete(config), false);

  const odd = normalizeConfig({ address: 'ftp://x', poll_interval: '10', language: 'it' });
  assert.equal(odd.addressInvalid, true);
  assert.equal(odd.pollIntervalMs, 60_000, 'never faster than a minute');
  assert.equal(odd.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: 300 }).pollIntervalMs, 300_000);
});

test('the password is kept as typed, but for a pasted line break', () => {
  const config = normalizeConfig({
    address: '192.0.2.50',
    username: ' gladys ',
    password: '  a b c  \n',
  });
  assert.equal(config.username, 'gladys');
  assert.equal(config.password, '  a b c  ');
  assert.equal(isComplete(config), true);
  assert.equal(hostOf(config.url), '192.0.2.50');
});
