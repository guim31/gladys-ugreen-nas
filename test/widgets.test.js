// -----------------------------------------------------------------------------
// The `nas` widget: valid for the core in every state and language (the SDK
// validator: vocabulary, budget, lengths), the problems first, and the Refresh
// button that reads the NAS again.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { ACTIONS, MAX_ROWS } from '../src/widgets.js';
import { FakeUgos } from './helpers/fakeUgos.js';
import { CONFIG, createWorld } from './helpers/world.js';

const LANGUAGES = ['en', 'fr', 'de', 'es'];

async function content(world, language = 'en') {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

const status = (widget) => widget.components.find((c) => c.type === 'status');

test('a NAS that answers: valid, three tiles, the volumes, a Refresh button', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const language of LANGUAGES) {
    const widget = await content(world, language);
    assert.deepEqual(validateWidgetContent(widget), [], language);
    assert.deepEqual(
      widget.components.map((c) => c.type),
      ['text', 'gauge', 'gauge', 'value', 'status', 'button'],
    );
  }
  const widget = await content(world, 'fr');
  assert.equal(widget.components[0].text, 'NASync');
  assert.deepEqual(
    status(widget).items.map((item) => [item.label, item.value]),
    [
      ['Volume 1', '63 % · 1,4 To libres'],
      ['Volume 2', '12 % · 860 Go libres'],
      ['Réseau', '↓ 10 · ↑ 2 Mbit/s'],
      ['En marche depuis', '12 j 6 h'],
    ],
  );
});

test('the problems come first, with their state', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.nas.setPoolStatus('pool2', 2);
  world.nas.setDisk('WD-TESTDISK0001', { status: 4 });
  await world.fake.widgetAction(WIDGET_KEY, ACTIONS.REFRESH);
  const widget = await content(world);
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.deepEqual(
    status(widget)
      .items.slice(0, 2)
      .map((item) => [item.label, item.value, item.color]),
    [
      ['Volume 2', 'Degraded', 'danger'],
      ['Disk 1', 'Failing', 'danger'],
    ],
  );
});

test('many volumes stay within the budget of rows', async (t) => {
  const nas = new FakeUgos();
  const [pool] = nas.pools.data.result;
  for (let i = 3; i <= 12; i += 1) {
    pool.volumes.push({ ...pool.volumes[0], name: `volume${i}`, label: `Volume ${i}` });
  }
  const world = await createWorld({ nas });
  t.after(() => world.app.stop());
  const widget = await content(world);
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(status(widget).items.length, MAX_ROWS);
  assert.equal(status(widget).items.at(-1).label, 'Others');
});

test('a NAS that does not answer says so, and Refresh reads it again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.nas.failure = 'down';
  await world.hub.afterChanges(await world.hub.poll());
  for (const language of LANGUAGES) {
    const widget = await content(world, language);
    assert.deepEqual(validateWidgetContent(widget), []);
    assert.deepEqual(
      widget.components.map((c) => c.type),
      ['text', 'text', 'button'],
    );
  }
  world.nas.failure = null;
  const ack = await world.fake.widgetAction(WIDGET_KEY, ACTIONS.REFRESH);
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.en, 'NAS read again.');
  assert.equal((await content(world)).components[1].type, 'gauge');
});

test('not configured: one sentence', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, password: '' } });
  t.after(() => world.app.stop());
  const widget = await content(world, 'de');
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.match(widget.components[0].text, /Gib die Adresse/);
});

test('an unknown widget action is refused', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetAction(WIDGET_KEY, 'reboot');
  assert.equal(ack.success, false);
});
