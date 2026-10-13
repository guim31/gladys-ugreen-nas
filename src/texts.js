// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, state words (features, scene variables, widget
// rows) and the "Test the connection" report. Four languages, the four of the
// Gladys interface; German says "du", Spanish "usted". test/i18n.test.js
// checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './ugos/client.js';

export const LANGUAGE_FALLBACK = 'en';

/** The text of a multi-language object in a language, English otherwise. */
export const pick = (text, language) =>
  text?.[language] ?? text?.[LANGUAGE_FALLBACK] ?? Object.values(text ?? {})[0] ?? '';

/** "Name: detail", with the French space before the colon. */
export const labelled = (name, detail, language) =>
  language === 'fr' ? `${name} : ${detail}` : `${name}: ${detail}`;

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  notConfigured: {
    en: 'Enter the address of the NAS, a user name and a password in the configuration.',
    fr: "Saisissez l'adresse du NAS, un nom d'utilisateur et un mot de passe dans la configuration.",
    de: 'Gib die Adresse des NAS, einen Benutzernamen und ein Passwort in der Konfiguration ein.',
    es: 'Introduzca la dirección del NAS, un nombre de usuario y una contraseña en la configuración.',
  },
  invalidAddress: {
    en: 'Address not understood, e.g. 192.168.1.50 or http://192.168.1.50:9999',
    fr: 'Adresse incomprise, ex. 192.168.1.50 ou http://192.168.1.50:9999',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.50 oder http://192.168.1.50:9999',
    es: 'Dirección no válida, p. ej. 192.168.1.50 o http://192.168.1.50:9999',
  },
};

// One short explanation per error kind (src/ugos/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer (is it on, is the address right?)',
    fr: "ne répond pas (est-il allumé, l'adresse est-elle juste ?)",
    de: 'antwortet nicht (ist es an, stimmt die Adresse?)',
    es: 'no responde (¿está encendido, es correcta la dirección?)',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user name or password refused; fix them, then save',
    fr: "nom d'utilisateur ou mot de passe refusé ; corrigez-les puis enregistrez",
    de: 'Benutzername oder Passwort abgelehnt; korrigiere sie und speichere',
    es: 'nombre de usuario o contraseña rechazados; corríjalos y guarde',
  },
  [ERROR_KINDS.OTP]: {
    en: 'this account uses two-factor authentication: use an account without it',
    fr: "ce compte utilise la double authentification : utilisez un compte qui ne l'a pas",
    de: 'dieses Konto nutzt die Zwei-Faktor-Anmeldung: Nimm ein Konto ohne sie',
    es: 'esta cuenta usa la verificación en dos pasos: use una cuenta sin ella',
  },
  [ERROR_KINDS.NOT_UGOS]: {
    en: 'no UGOS Pro API at this address (port 9999?)',
    fr: "pas d'API UGOS Pro à cette adresse (port 9999 ?)",
    de: 'keine UGOS-Pro-API unter dieser Adresse (Port 9999?)',
    es: 'no hay API de UGOS Pro en esta dirección (¿puerto 9999?)',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of a volume (src/ugos/model.js VOLUME_STATES), in words.
export const VOLUME_STATE_TEXT = {
  normal: { en: 'Healthy', fr: 'Sain', de: 'Intakt', es: 'Correcto' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  warning: { en: 'Warning', fr: 'Avertissement', de: 'Warnung', es: 'Advertencia' },
  rebuilding: { en: 'Rebuilding', fr: 'Reconstruction', de: 'Wiederaufbau', es: 'Reconstruyendo' },
  degraded: { en: 'Degraded', fr: 'Dégradé', de: 'Beeinträchtigt', es: 'Degradado' },
  faulty: { en: 'Faulty', fr: 'Défaillant', de: 'Defekt', es: 'Averiado' },
};

// The state of a disk (src/ugos/model.js DISK_STATES), in words.
export const DISK_STATE_TEXT = {
  normal: { en: 'Healthy', fr: 'Sain', de: 'Intakt', es: 'Correcto' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  undetectable: { en: 'Not detected', fr: 'Non détecté', de: 'Nicht erkannt', es: 'No detectado' },
  locked: { en: 'Locked', fr: 'Verrouillé', de: 'Gesperrt', es: 'Bloqueado' },
  warning: { en: 'Warning', fr: 'Avertissement', de: 'Warnung', es: 'Advertencia' },
  critical: { en: 'Critical', fr: 'Critique', de: 'Kritisch', es: 'Crítico' },
  failing: { en: 'Failing', fr: 'En panne', de: 'Ausfall', es: 'En fallo' },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'connected',
    volumes: (count) => `${count} volume(s)`,
    disks: (count) => `${count} disk(s)`,
    noStorage: 'storage not readable with this account',
  },
  fr: {
    ok: 'connecté',
    volumes: (count) => `${count} volume(s)`,
    disks: (count) => `${count} disque(s)`,
    noStorage: 'stockage illisible avec ce compte',
  },
  de: {
    ok: 'verbunden',
    volumes: (count) => `${count} Volume(s)`,
    disks: (count) => `${count} Festplatte(n)`,
    noStorage: 'Speicher mit diesem Konto nicht lesbar',
  },
  es: {
    ok: 'conectado',
    volumes: (count) => `${count} volumen(es)`,
    disks: (count) => `${count} disco(s)`,
    noStorage: 'almacenamiento no legible con esta cuenta',
  },
};

// Short units, for the widget rows.
export const UNIT_TEXT = {
  gigabyte: { en: 'GB', fr: 'Go', de: 'GB', es: 'GB' },
  terabyte: { en: 'TB', fr: 'To', de: 'TB', es: 'TB' },
  day: { en: 'd', fr: 'j', de: 'T', es: 'd' },
  hour: { en: 'h', fr: 'h', de: 'Std.', es: 'h' },
};

const LOCALES = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

export const formatNumber = (value, language, digits = 1) =>
  new Intl.NumberFormat(LOCALES[language] ?? LOCALES.en, {
    maximumFractionDigits: digits,
  }).format(value);

export const formatPercent = (value, language) => `${formatNumber(value, language, 0)} %`;

/** Bytes as GB, or TB from 1000 GB on (decimal units, as UGOS shows them). */
export function formatSize(bytes, language) {
  const gigabytes = bytes / 1e9;
  if (gigabytes >= 1000) {
    return `${formatNumber(gigabytes / 1000, language, 1)} ${pick(UNIT_TEXT.terabyte, language)}`;
  }
  return `${formatNumber(gigabytes, language, gigabytes < 10 ? 1 : 0)} ${pick(UNIT_TEXT.gigabyte, language)}`;
}

/** Seconds as "12 d 4 h". */
export function formatUptime(seconds, language) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const day = pick(UNIT_TEXT.day, language);
  const hour = pick(UNIT_TEXT.hour, language);
  return days > 0 ? `${days} ${day} ${hours} ${hour}` : `${hours} ${hour}`;
}
