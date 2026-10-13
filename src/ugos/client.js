// -----------------------------------------------------------------------------
// UGOS Pro client: the undocumented JSON API the web interface of a UGREEN
// NASync uses, under `/ugreen/` on port 9999 (plain HTTP) by default.
//
// Login, as described by Fracizz/ugnas-api (MIT):
//   1. POST /ugreen/v1/verify/check { username } -> the response header
//      `x-rsa-token` carries the RSA public key (base64 of a PEM, sometimes
//      of a DER);
//   2. the password is encrypted with it (RSA PKCS#1 v1.5, base64): it never
//      travels in clear, even over plain HTTP;
//   3. POST /ugreen/v1/verify/login -> `data.token`, sent back as the `token`
//      query parameter of every request (and as the `X-Ugreen-Token` header
//      when `data.auth_type` asks for it).
// An expired token answers `code: 1024` (or HTTP 401): the client logs in
// again once, then repeats the request.
//
// Read only. Four GET per refresh, nothing else:
//   - /ugreen/v1/sysinfo/machine/common: name, model, serial, UGOS version,
//     uptime;
//   - /ugreen/v1/taskmgr/stat/get_all: CPU, memory, network, temperatures
//     (`taskmgr/stat/overview` on firmwares without `get_all`);
//   - /ugreen/v1/storage/pool/list: pools and their volumes, sizes, states;
//   - /ugreen/v2/storage/disk/list: disks, states, temperatures.
// The SMART endpoints (`storage/disk/smart/...`) are never called: they run
// smartctl on the NAS and wake sleeping disks every time.
//
// The token and the password are never logged, never put in an error message.
// -----------------------------------------------------------------------------

import { constants, createPublicKey, publicEncrypt, randomUUID } from 'node:crypto';
import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: off, wrong address, firewall
  AUTH: 'auth', // user name or password refused
  OTP: 'otp', // the account asks for a two-factor code
  NOT_UGOS: 'not_ugos', // something answers, not the UGOS Pro API
  HTTP: 'http', // any other HTTP or API error
});

export class UgosError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status, code }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'UgosError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

export const PATHS = Object.freeze({
  CHECK: '/ugreen/v1/verify/check',
  LOGIN: '/ugreen/v1/verify/login',
  MACHINE: '/ugreen/v1/sysinfo/machine/common',
  STATS: '/ugreen/v1/taskmgr/stat/get_all',
  STATS_FALLBACK: '/ugreen/v1/taskmgr/stat/overview',
  POOLS: '/ugreen/v1/storage/pool/list',
  DISKS: '/ugreen/v2/storage/disk/list',
});

// API codes: 200 is success, 1024 an expired token.
const CODE_OK = 200;
const CODE_EXPIRED = 1024;

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
]);

// The language UGOS writes its labels in ("Disk 1", "Volume 1").
const LOCALES = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/**
 * The RSA public key of `x-rsa-token`: base64 of a PEM (PKCS#1 or SPKI, the
 * PKCS#1 label sometimes wrapping an SPKI body) or of a DER.
 * @param {string} raw header value
 * @returns {import('node:crypto').KeyObject}
 */
export function loadPublicKey(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    throw new Error('empty key');
  }
  const decoded = text.includes('BEGIN') ? Buffer.from(text) : Buffer.from(text, 'base64');
  const pem = decoded.toString('utf8');
  if (pem.includes('BEGIN')) {
    try {
      return createPublicKey(pem);
    } catch {
      return createPublicKey(
        pem
          .replace(/BEGIN RSA PUBLIC KEY/g, 'BEGIN PUBLIC KEY')
          .replace(/END RSA PUBLIC KEY/g, 'END PUBLIC KEY'),
      );
    }
  }
  try {
    return createPublicKey({ key: decoded, format: 'der', type: 'spki' });
  } catch {
    return createPublicKey({ key: decoded, format: 'der', type: 'pkcs1' });
  }
}

/** The password encrypted the way the web interface does: RSA PKCS#1 v1.5, base64. */
export function encryptPassword(publicKey, password) {
  return publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(password, 'utf8'),
  ).toString('base64');
}

const header = (headers, name) => {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

export class UgosClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL (src/config.js parseAddress)
   * @param {string} options.username
   * @param {string} options.password
   * @param {string} [options.language] language of the labels UGOS writes
   * @param {Function} [options.request] HTTP seam (src/ugos/http.js)
   */
  constructor({ url, username, password, language = 'en', request = httpRequest }) {
    this.url = url;
    this.username = username;
    // Not enumerable: never serialized with the client (logs, JSON dumps).
    Object.defineProperty(this, 'password', { value: password, enumerable: false });
    Object.defineProperty(this, 'token', { value: null, writable: true, enumerable: false });
    this.tokenInHeader = false;
    this.locale = LOCALES[language] ?? LOCALES.en;
    this.request = request;
    this.clientId = randomUUID();
    // `get_all` is tried first; a firmware that refuses it is read with `overview`.
    this.statsPath = PATHS.STATS;
  }

  headers(extra = {}) {
    return {
      Accept: 'application/json, text/plain, */*',
      'UG-Agent': 'PC/WEB',
      'Client-Id': this.clientId,
      'X-Specify-Language': this.locale,
      ...extra,
    };
  }

  /** One HTTP exchange; network failures become UNREACHABLE errors. */
  async send(path, { method = 'GET', body, query = {} } = {}) {
    const target = new URL(path, this.url);
    for (const [key, value] of Object.entries(query)) {
      target.searchParams.set(key, value);
    }
    const headers = this.headers(
      body === undefined ? {} : { 'Content-Type': 'application/json;charset=UTF-8' },
    );
    if (query.token && this.tokenInHeader) {
      headers['X-Ugreen-Token'] = query.token;
    }
    try {
      return await this.request(target.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // The NAS serves a self-signed certificate over HTTPS.
        insecure: true,
      });
    } catch (err) {
      if (NETWORK_CODES.has(err.code) || /socket hang up/i.test(err.message ?? '')) {
        throw new UgosError(ERROR_KINDS.UNREACHABLE, `${path}: ${err.code ?? err.message}`);
      }
      throw new UgosError(ERROR_KINDS.HTTP, `${path}: ${err.code ?? err.message}`);
    }
  }

  /** The JSON envelope `{ code, msg, data }` of a response. */
  static parse(path, response) {
    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch {
      throw new UgosError(
        response.status >= 200 && response.status < 400 ? ERROR_KINDS.NOT_UGOS : ERROR_KINDS.HTTP,
        `${path}: HTTP ${response.status}, not JSON`,
        { status: response.status },
      );
    }
    if (!payload || typeof payload !== 'object' || !('code' in payload)) {
      throw new UgosError(ERROR_KINDS.NOT_UGOS, `${path}: no UGOS envelope`, {
        status: response.status,
      });
    }
    return payload;
  }

  /** Log in: fetch the RSA key, send the encrypted password, keep the token. */
  async login() {
    this.token = null;
    const check = await this.send(PATHS.CHECK, {
      method: 'POST',
      body: { username: this.username },
    });
    if (check.status === 404) {
      throw new UgosError(ERROR_KINDS.NOT_UGOS, `${PATHS.CHECK}: HTTP 404`, { status: 404 });
    }
    const rsaToken = header(check.headers, 'x-rsa-token');
    if (!rsaToken) {
      // The envelope tells a refused user name from a server that is not UGOS.
      let payload = null;
      try {
        payload = UgosClient.parse(PATHS.CHECK, check);
      } catch {
        // Not UGOS: handled below.
      }
      if (payload && payload.code !== CODE_OK) {
        throw new UgosError(ERROR_KINDS.AUTH, `login refused (code ${payload.code})`, {
          code: payload.code,
        });
      }
      throw new UgosError(ERROR_KINDS.NOT_UGOS, `${PATHS.CHECK}: no x-rsa-token header`, {
        status: check.status,
      });
    }
    let encrypted;
    try {
      encrypted = encryptPassword(loadPublicKey(rsaToken), this.password);
    } catch (err) {
      throw new UgosError(ERROR_KINDS.NOT_UGOS, `x-rsa-token unusable: ${err.message}`);
    }
    const response = await this.send(PATHS.LOGIN, {
      method: 'POST',
      body: {
        username: this.username,
        password: encrypted,
        keepalive: true,
        otp: false,
        is_simple: false,
      },
    });
    const payload = UgosClient.parse(PATHS.LOGIN, response);
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    if (payload.code === CODE_OK && typeof data.token === 'string' && data.token) {
      this.token = data.token;
      this.tokenInHeader = Boolean(data.auth_type) && data.auth_type !== 'url';
      return;
    }
    if (data.enable_otp || data.token_id) {
      throw new UgosError(ERROR_KINDS.OTP, 'the account asks for a two-factor code');
    }
    throw new UgosError(ERROR_KINDS.AUTH, `login refused (code ${payload.code})`, {
      code: payload.code,
    });
  }

  /**
   * GET an API path with the token; logs in first if needed, and again once
   * when the token expired.
   * @returns {Promise<any>} the `data` of the envelope
   */
  async get(path, { retried = false } = {}) {
    if (!this.token) {
      await this.login();
    }
    const response = await this.send(path, { query: { token: this.token } });
    let payload = null;
    if (response.status !== 401) {
      payload = UgosClient.parse(path, response);
    }
    if (response.status === 401 || payload.code === CODE_EXPIRED) {
      this.token = null;
      if (retried) {
        throw new UgosError(ERROR_KINDS.AUTH, `${path}: session refused after a new login`, {
          status: response.status,
        });
      }
      return this.get(path, { retried: true });
    }
    if (payload.code !== CODE_OK) {
      throw new UgosError(ERROR_KINDS.HTTP, `${path}: code ${payload.code}`, {
        status: response.status,
        code: payload.code,
      });
    }
    return payload.data ?? null;
  }

  /** The live statistics: `get_all`, or `overview` once `get_all` was refused. */
  async stats() {
    try {
      return await this.get(this.statsPath);
    } catch (err) {
      if (err.kind !== ERROR_KINDS.HTTP || this.statsPath === PATHS.STATS_FALLBACK) {
        throw err;
      }
      const data = await this.get(PATHS.STATS_FALLBACK);
      this.statsPath = PATHS.STATS_FALLBACK;
      return data;
    }
  }

  /**
   * One complete read. The machine information is required; statistics and
   * storage are read independently, a part refused (an account without the
   * right, a firmware without the endpoint) leaves its field null and its
   * error in `errors`. A NAS that stops answering fails the whole read.
   * @returns {Promise<{ machine: any, stats: any, pools: any, disks: any,
   *   errors: Record<string, string> }>}
   */
  async read() {
    const machine = await this.get(PATHS.MACHINE);
    const errors = {};
    const optional = async (name, fn) => {
      try {
        return await fn();
      } catch (err) {
        if (err.kind === ERROR_KINDS.UNREACHABLE || err.kind === ERROR_KINDS.AUTH) {
          throw err;
        }
        errors[name] = err.message;
        return null;
      }
    };
    // One request at a time: a small NAS answers the web interface too.
    const stats = await optional('stats', () => this.stats());
    const pools = await optional('pools', () => this.get(PATHS.POOLS));
    const disks = await optional('disks', () => this.get(PATHS.DISKS));
    return { machine, stats, pools, disks, errors };
  }
}
