// -----------------------------------------------------------------------------
// An in-memory UGREEN NAS answering the UGOS Pro API the way the integration
// reads it (src/ugos/client.js), on a fake network: the RSA login for real (a
// key pair generated for the test, the password decrypted and compared), the
// session tokens, the `code: 1024` of an expired token, and the four read
// endpoints served from the fixtures (test/fixtures/ugos). No socket is opened.
// -----------------------------------------------------------------------------

import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const USERNAME = 'gladys';
// Not a secret: the password of the fake NAS only.
export const PASSWORD = 'fake-password-for-tests';

export const readFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/ugos/${name}`, import.meta.url), 'utf8'));

// One key pair for the whole run: generating one takes a few milliseconds.
const KEYS = generateKeyPairSync('rsa', { modulusLength: 2048 });

/** RSA PKCS#1 v1.5 decryption by hand: Node refuses it as a padding mode since CVE-2023-46809. */
function decryptPkcs1(privateKey, base64) {
  const raw = privateDecrypt(
    { key: privateKey, padding: constants.RSA_NO_PADDING },
    Buffer.from(base64, 'base64'),
  );
  if (raw[0] !== 0x00 || raw[1] !== 0x02) {
    throw new Error('bad padding');
  }
  const separator = raw.indexOf(0x00, 2);
  if (separator < 10) {
    throw new Error('bad padding');
  }
  return raw.subarray(separator + 1).toString('utf8');
}

const json = (status, payload, headers = {}) => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(payload),
});

export class FakeUgos {
  /**
   * @param {object} [options]
   * @param {'pem-spki'|'pem-pkcs1'|'der'} [options.keyFormat] how x-rsa-token encodes the key
   * @param {boolean} [options.otp] the account asks for a two-factor code
   * @param {boolean} [options.getAll] the firmware serves taskmgr/stat/get_all
   * @param {boolean} [options.storage] the account may read the storage lists
   * @param {'url'|'header'} [options.authType] where the token is expected
   */
  constructor({
    keyFormat = 'pem-spki',
    otp = false,
    getAll = true,
    storage = true,
    authType = 'url',
  } = {}) {
    this.keyFormat = keyFormat;
    this.otp = otp;
    this.getAll = getAll;
    this.storage = storage;
    this.authType = authType;
    this.machine = readFixture('machine-common.json');
    this.stats = readFixture('stat-get_all.json');
    this.pools = readFixture('pool-list.json');
    this.disks = readFixture('disk-list.json');
    this.tokens = new Set();
    this.logins = 0;
    this.failedLogins = 0;
    /** @type {null|'down'|'html'} */
    this.failure = null;
    /** Every request received: method, path, query, headers, body. */
    this.requests = [];
    this.nextToken = 1;
  }

  rsaToken() {
    if (this.keyFormat === 'der') {
      return KEYS.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    }
    const pem = KEYS.publicKey.export({
      type: this.keyFormat === 'pem-pkcs1' ? 'pkcs1' : 'spki',
      format: 'pem',
    });
    return Buffer.from(pem).toString('base64');
  }

  /** Every session ends, as after a NAS restart or a token timeout. */
  expireTokens() {
    this.tokens.clear();
  }

  setPoolStatus(name, status) {
    this.pools.data.result.find((pool) => pool.name === name).status = status;
  }

  setVolumeStatus(name, status) {
    for (const pool of this.pools.data.result) {
      for (const volume of pool.volumes) {
        if (volume.name === name) {
          volume.status = status;
        }
      }
    }
  }

  setDisk(serial, changes) {
    Object.assign(
      this.disks.data.result.find((disk) => disk.serial === serial),
      changes,
    );
  }

  setCpu(usedPercent) {
    this.stats.data.overview.cpu[0].used_percent = usedPercent;
  }

  handle(url, { method = 'GET', headers = {}, body } = {}) {
    const target = new URL(url);
    const query = Object.fromEntries(target.searchParams);
    const parsedBody = body === undefined ? undefined : JSON.parse(body);
    this.requests.push({ method, path: target.pathname, query, headers, body: parsedBody });
    if (this.failure === 'html') {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<html></html>' };
    }

    if (target.pathname === '/ugreen/v1/verify/check' && method === 'POST') {
      return json(200, { code: 200, msg: 'success', data: {} }, { 'x-rsa-token': this.rsaToken() });
    }
    if (target.pathname === '/ugreen/v1/verify/login' && method === 'POST') {
      let password = null;
      try {
        password = decryptPkcs1(KEYS.privateKey, parsedBody.password);
      } catch {
        // A password not encrypted with our key: refused below.
      }
      if (parsedBody.username !== USERNAME || password !== PASSWORD) {
        this.failedLogins += 1;
        return json(200, { code: 1005, msg: 'username or password error', data: null });
      }
      this.logins += 1;
      if (this.otp) {
        return json(200, { code: 200, msg: 'success', data: { enable_otp: true, token_id: 'x' } });
      }
      const token = `session-${this.nextToken++}`;
      this.tokens.add(token);
      return json(200, {
        code: 200,
        msg: 'success',
        data: { token, auth_type: this.authType, public_key: '', static_token: '' },
      });
    }

    const token =
      this.authType === 'header'
        ? (headers['X-Ugreen-Token'] ?? headers['x-ugreen-token'])
        : query.token;
    if (!this.tokens.has(token)) {
      return json(200, { code: 1024, msg: 'token expired', data: null });
    }
    const forbidden = json(200, { code: 9004, msg: 'no permission', data: null });
    switch (target.pathname) {
      case '/ugreen/v1/sysinfo/machine/common':
        return json(200, this.machine);
      case '/ugreen/v1/taskmgr/stat/get_all':
        return this.getAll ? json(200, this.stats) : json(404, { code: 404, msg: 'not found' });
      case '/ugreen/v1/taskmgr/stat/overview':
        return json(200, { code: 200, msg: 'success', data: this.stats.data.overview });
      case '/ugreen/v1/storage/pool/list':
        return this.storage ? json(200, this.pools) : forbidden;
      case '/ugreen/v2/storage/disk/list':
        return this.storage ? json(200, this.disks) : forbidden;
      default:
        return json(404, { code: 404, msg: 'not found' });
    }
  }
}

/**
 * A fake network: the request function of the client, routed by origin.
 * @param {Record<string, FakeUgos>} nasByOrigin
 */
export function createNetwork(nasByOrigin) {
  const calls = [];
  return {
    calls,
    async request(url, options = {}) {
      calls.push({ url, options });
      const nas = nasByOrigin[new URL(url).origin];
      if (!nas || nas.failure === 'down') {
        const error = new Error(nas ? 'connect ETIMEDOUT' : 'connect ECONNREFUSED');
        error.code = nas ? 'ETIMEDOUT' : 'ECONNREFUSED';
        throw error;
      }
      return nas.handle(url, options);
    },
  };
}
