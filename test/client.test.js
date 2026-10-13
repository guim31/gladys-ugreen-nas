// -----------------------------------------------------------------------------
// The UGOS Pro client against the fake NAS: the RSA login with every key
// encoding UGOS was seen to send, the token in the query or the header, the
// new login on an expired token, the errors in words, and the read itself —
// four GET, never a SMART request, never the password in clear.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, PATHS, UgosClient, loadPublicKey } from '../src/ugos/client.js';
import { FakeUgos, PASSWORD, USERNAME, createNetwork } from './helpers/fakeUgos.js';

const ORIGIN = 'http://192.0.2.50:9999';

function setup(options = {}, credentials = {}) {
  const nas = new FakeUgos(options);
  const network = createNetwork({ [ORIGIN]: nas });
  const client = new UgosClient({
    url: ORIGIN,
    username: credentials.username ?? USERNAME,
    password: credentials.password ?? PASSWORD,
    request: network.request,
  });
  return { nas, network, client };
}

for (const keyFormat of ['pem-spki', 'pem-pkcs1', 'der']) {
  test(`logs in with an RSA key sent as ${keyFormat}`, async () => {
    const { nas, client } = setup({ keyFormat });
    const read = await client.read();
    assert.equal(nas.logins, 1);
    assert.equal(read.machine.common.serial, 'UGTEST00000001');
  });
}

test('a PKCS#1 label around an SPKI body is accepted', () => {
  const { nas } = setup();
  const spki = Buffer.from(nas.rsaToken(), 'base64').toString('utf8');
  const mislabelled = spki
    .replace('BEGIN PUBLIC KEY', 'BEGIN RSA PUBLIC KEY')
    .replace('END PUBLIC KEY', 'END RSA PUBLIC KEY');
  assert.equal(loadPublicKey(Buffer.from(mislabelled).toString('base64')).asymmetricKeyType, 'rsa');
});

test('the password travels encrypted, never in clear', async () => {
  const { network, client } = setup();
  await client.read();
  for (const call of network.calls) {
    assert.ok(!call.url.includes(PASSWORD));
    assert.ok(!(call.options.body ?? '').includes(PASSWORD));
    assert.ok(!JSON.stringify(call.options.headers).includes(PASSWORD));
  }
  const login = network.calls.find((call) => call.url.endsWith(PATHS.LOGIN));
  const body = JSON.parse(login.options.body);
  assert.equal(body.username, USERNAME);
  assert.match(body.password, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(body.keepalive, true);
});

test('reads the four endpoints, read only, never a SMART request', async () => {
  const { nas, client } = setup();
  await client.read();
  const reads = nas.requests.filter((request) => request.method === 'GET').map((r) => r.path);
  assert.deepEqual(reads, [PATHS.MACHINE, PATHS.STATS, PATHS.POOLS, PATHS.DISKS]);
  assert.ok(nas.requests.every((request) => !/smart|detection|attribute/.test(request.path)));
  assert.ok(
    nas.requests
      .filter((request) => request.method === 'POST')
      .every((request) => request.path.startsWith('/ugreen/v1/verify/')),
    'the only POST are the two of the login',
  );
});

test('the token goes in the query, and in a header when UGOS asks for it', async () => {
  const query = setup();
  await query.client.read();
  const get = query.nas.requests.find((request) => request.path === PATHS.MACHINE);
  assert.match(get.query.token, /^session-/);
  assert.equal(get.headers['X-Ugreen-Token'], undefined);

  const header = setup({ authType: 'header' });
  const read = await header.client.read();
  assert.ok(read.machine);
  const withHeader = header.nas.requests.find((request) => request.path === PATHS.MACHINE);
  assert.match(withHeader.headers['X-Ugreen-Token'], /^session-/);
});

test('one session for every read, a new login once it expired', async () => {
  const { nas, client } = setup();
  await client.read();
  await client.read();
  assert.equal(nas.logins, 1);
  nas.expireTokens();
  await client.read();
  assert.equal(nas.logins, 2);
});

test('a refused password is an AUTH error, tried once', async () => {
  const { nas, client } = setup({}, { password: 'wrong' });
  await assert.rejects(client.read(), (err) => err.kind === ERROR_KINDS.AUTH);
  assert.equal(nas.failedLogins, 1);
});

test('an account with two-factor authentication is an OTP error', async () => {
  const { client } = setup({ otp: true });
  await assert.rejects(client.read(), (err) => err.kind === ERROR_KINDS.OTP);
});

test('a NAS that does not answer is UNREACHABLE, a web page is NOT_UGOS', async () => {
  const down = setup();
  down.nas.failure = 'down';
  await assert.rejects(down.client.read(), (err) => err.kind === ERROR_KINDS.UNREACHABLE);

  const nobody = new UgosClient({
    url: 'http://192.0.2.99:9999',
    username: USERNAME,
    password: PASSWORD,
    request: createNetwork({}).request,
  });
  await assert.rejects(nobody.read(), (err) => err.kind === ERROR_KINDS.UNREACHABLE);

  const html = setup();
  html.nas.failure = 'html';
  await assert.rejects(html.client.read(), (err) => err.kind === ERROR_KINDS.NOT_UGOS);
});

test('a firmware without stat/get_all is read with stat/overview', async () => {
  const { nas, client } = setup({ getAll: false });
  const first = await client.read();
  assert.equal(first.stats.cpu[0].used_percent, 12.4);
  await client.read();
  const stats = nas.requests.filter((request) => request.path.startsWith('/ugreen/v1/taskmgr'));
  assert.deepEqual(
    stats.map((request) => request.path),
    [PATHS.STATS, PATHS.STATS_FALLBACK, PATHS.STATS_FALLBACK],
  );
});

test('storage refused to the account: the rest is read, the parts say why', async () => {
  const { client } = setup({ storage: false });
  const read = await client.read();
  assert.ok(read.machine);
  assert.ok(read.stats);
  assert.equal(read.pools, null);
  assert.equal(read.disks, null);
  assert.deepEqual(Object.keys(read.errors).sort(), ['disks', 'pools']);
});

test('error messages and the client itself never carry the password or the token', async () => {
  const { client } = setup({}, { password: PASSWORD });
  await client.read();
  assert.ok(!JSON.stringify(client).includes(PASSWORD));
  assert.ok(!JSON.stringify(client).includes('session-'));
  const refused = setup({}, { password: `${PASSWORD}-wrong` });
  await assert.rejects(refused.client.read(), (err) => {
    assert.ok(!err.message.includes(PASSWORD));
    return true;
  });
});
