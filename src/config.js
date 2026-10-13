// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One NAS per installation: the address of its UGOS Pro API (port 9999 over
// plain HTTP by default, see src/ugos/client.js), an account of the NAS, the
// refresh interval and the language of the texts sent to Gladys.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// The JSON API of UGOS Pro answers over plain HTTP on this port.
export const DEFAULT_PORT = 9999;

// Refresh intervals offered in the configuration, in seconds: one minute at
// most often, the cadence asked for a NAS.
export const POLL_INTERVALS = ['60', '120', '300'];

export const DEFAULT_CONFIG = {
  address: '',
  username: '',
  password: '',
  poll_interval: '60',
  language: 'fr',
};

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.50`, port 9999 added), `host:port`, or a URL copied from the
 * browser (`http://192.0.2.50:9999/desktop/`). HTTP by default. The path is
 * dropped: the API always lives under `/ugreen/` at the root.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port]`, null when unusable
 */
export function parseAddress(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the messages.
  if (url.username || url.password) {
    return null;
  }
  // A bare host means the API port; an explicit scheme without a port means
  // the web interface port (80/443), which some firmwares also serve the API on.
  if (!hasScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  return url.origin;
}

/** Host part shown to the user (no scheme, no default API port). */
export const hostOf = (url) =>
  url.replace(/^https?:\/\//, '').replace(new RegExp(`:${DEFAULT_PORT}$`), '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 * @returns {{ url: string|null, addressInvalid: boolean, username: string, password: string,
 *   pollIntervalMs: number, language: string }}
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const typed = text('address');
  const url = parseAddress(typed);
  return {
    url,
    addressInvalid: Boolean(typed) && url === null,
    username: text('username'),
    // A pasted password often carries a trailing new line; spaces are kept.
    password:
      typeof source.password === 'string' ? source.password.replace(/^[\r\n]+|[\r\n]+$/g, '') : '',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Whether the configuration has everything needed to log in. */
export const isComplete = (config) => Boolean(config.url && config.username && config.password);
