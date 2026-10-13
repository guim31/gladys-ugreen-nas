// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `nas`.
//
// The use case: a glance at the wall tablet tells whether the NAS is fine.
// Two gauges (CPU, memory) and the CPU temperature as tiles, then the rows:
// the volumes and disks that need attention first, then every volume with its
// use and free space, the network rates and the uptime. A NAS that does not
// answer says so in words.
//
// No setting: one NAS per installation. The figures are sent as values, not
// bound to device features: the widget works before any device is added.
//
// Budget (8 components, 6 tiles, 2 texts, 1 status, 4 buttons): a heading,
// three tiles, one status list of eight rows at most and a Refresh button;
// a heading, one text and the button when the NAS does not answer.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { DISK_STATES, VOLUME_STATES } from './ugos/model.js';
import {
  CONNECTION_TEXT,
  DISK_STATE_TEXT,
  ERROR_TEXT,
  VOLUME_STATE_TEXT,
  formatNumber,
  formatPercent,
  formatSize,
  formatUptime,
  labelled,
  pick,
} from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 8;

export const TEXT = {
  waiting: {
    en: 'Waiting for the first answer of the NAS…',
    fr: 'En attente de la première réponse du NAS…',
    de: 'Warte auf die erste Antwort des NAS …',
    es: 'Esperando la primera respuesta del NAS…',
  },
  cpu: { en: 'CPU', fr: 'Processeur', de: 'Prozessor', es: 'Procesador' },
  memory: { en: 'Memory', fr: 'Mémoire', de: 'Speicher', es: 'Memoria' },
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  network: { en: 'Network', fr: 'Réseau', de: 'Netzwerk', es: 'Red' },
  uptime: { en: 'Uptime', fr: 'En marche depuis', de: 'Läuft seit', es: 'En marcha desde' },
  free: { en: 'free', fr: 'libres', de: 'frei', es: 'libres' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'NAS read again.',
    fr: 'NAS relu.',
    de: 'NAS neu gelesen.',
    es: 'NAS leído de nuevo.',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Danger from 90, warning from 75: what a monitoring tool shows in red and orange. */
const usageColor = (value) =>
  value >= 90 ? WIDGET_COLORS.DANGER : value >= 75 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS;
const temperatureColor = (celsius) =>
  celsius >= 85
    ? WIDGET_COLORS.DANGER
    : celsius >= 70
      ? WIDGET_COLORS.WARNING
      : WIDGET_COLORS.NEUTRAL;
const stateColor = (severity) => (severity >= 2 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING);

function message(text, language, ttl = 300) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const refreshButton = (language) => ({
  type: 'button',
  label: t(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

const gauge = (label, value, language) => ({
  type: 'gauge',
  value: Math.round(value),
  min: 0,
  max: 100,
  unit: '%',
  label: t(label, language),
  color: usageColor(value),
});

/** The rows of the status list, the problems first. */
function rows(snapshot, language) {
  const alerts = [];
  const others = [];
  for (const volume of snapshot.volumes ?? []) {
    const state = VOLUME_STATES[volume.state];
    if (state.alert) {
      alerts.push({
        label: fit(volume.label, 40),
        value: t(VOLUME_STATE_TEXT[volume.state], language),
        icon: 'alert-triangle',
        color: stateColor(state.severity),
      });
      continue;
    }
    const parts = [];
    if (volume.percent !== null) {
      parts.push(formatPercent(volume.percent, language));
    }
    if (volume.free !== null) {
      parts.push(`${formatSize(volume.free, language)} ${t(TEXT.free, language)}`);
    }
    others.push({
      label: fit(volume.label, 40),
      value: fit(parts.join(' · ') || t(VOLUME_STATE_TEXT[volume.state], language), 40),
      icon: 'hard-drive',
      color: volume.percent === null ? WIDGET_COLORS.NEUTRAL : usageColor(volume.percent),
    });
  }
  for (const disk of snapshot.disks ?? []) {
    const state = DISK_STATES[disk.state];
    if (state.alert) {
      alerts.push({
        label: fit(disk.label, 40),
        value: t(DISK_STATE_TEXT[disk.state], language),
        icon: 'alert-octagon',
        color: stateColor(state.severity),
      });
    }
  }
  if (snapshot.rx !== null && snapshot.tx !== null) {
    const mbps = (bytes) => formatNumber((bytes * 8) / 1e6, language, 1);
    others.push({
      label: t(TEXT.network, language),
      value: `↓ ${mbps(snapshot.rx)} · ↑ ${mbps(snapshot.tx)} Mbit/s`,
      icon: 'activity',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (snapshot.uptime !== null) {
    others.push({
      label: t(TEXT.uptime, language),
      value: formatUptime(snapshot.uptime, language),
      icon: 'clock',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const all = [...alerts, ...others];
  if (all.length <= MAX_ROWS) {
    return all;
  }
  const shown = all.slice(0, MAX_ROWS - 1);
  shown.push({
    label: t(TEXT.more, language),
    value: `+${all.length - shown.length}`,
    icon: 'more-horizontal',
    color: WIDGET_COLORS.NEUTRAL,
  });
  return shown;
}

/** The tiles and the rows of a NAS that answers. */
function nasComponents(snapshot, language) {
  const components = [];
  if (snapshot.cpu !== null) {
    components.push(gauge(TEXT.cpu, snapshot.cpu, language));
  }
  if (snapshot.memory !== null) {
    components.push(gauge(TEXT.memory, snapshot.memory, language));
  }
  if (snapshot.cpuTemperature !== null) {
    components.push({
      type: 'value',
      value: Math.round(snapshot.cpuTemperature),
      unit: '°C',
      label: t(TEXT.temperature, language),
      icon: 'thermometer',
      color: temperatureColor(snapshot.cpuTemperature),
    });
  }
  const items = rows(snapshot, language);
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }
  return components;
}

async function get(hub, { language = 'en' } = {}) {
  const view = hub.view();
  if (!view.configured) {
    return message(
      hub.config?.addressInvalid ? CONNECTION_TEXT.invalidAddress : CONNECTION_TEXT.notConfigured,
      language,
    );
  }
  if (!view.online) {
    if (!view.error) {
      return message(TEXT.waiting, language, 30);
    }
    return {
      ttl_seconds: 30,
      components: [
        { type: 'text', variant: 'heading', text: fit(view.name, 40) },
        {
          type: 'text',
          variant: 'body',
          text: labelled(view.name, t(ERROR_TEXT[view.error.kind], language), language),
        },
        refreshButton(language),
      ],
    };
  }
  return {
    ttl_seconds: 60,
    components: [
      { type: 'text', variant: 'heading', text: fit(view.name, 40) },
      ...nasComponents(view.snapshot, language),
      refreshButton(language),
    ],
  };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  // A manual request: also tries again a password refused before.
  await hub.afterChanges(await hub.poll({ manual: true }));
  return TEXT.refreshed;
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
