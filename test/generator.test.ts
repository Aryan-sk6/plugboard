// The AI is replaced by scripted answers here; these tests check retry, fallback and cache logic only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRecipe, SYSTEM_PROMPT } from '../src/generator.ts';
import type { AskOptions, CliResult } from '../src/claude.ts';
import { listPlugins, type PluginItem } from '../src/reader.ts';
import { makeClaudeHome, goodRecipe } from './fixture.ts';

async function setup() {
  const home = await makeClaudeHome();
  const items = await listPlugins(home);
  const item = items.find((i) => i.name === 'invoice-maker') as PluginItem;
  const dataDir = await mkdtemp(join(tmpdir(), 'plugboard-data-'));
  return { item, dataDir };
}

function scripted(answers: CliResult[]) {
  const calls: AskOptions[] = [];
  return {
    calls,
    ask: async (o: AskOptions) => {
      calls.push(o);
      return answers.shift() ?? { ok: false, message: 'no more answers' };
    },
  };
}

test('generates once, then serves from cache', async () => {
  const { item, dataDir } = await setup();
  const s = scripted([{ ok: true, text: '', structured: goodRecipe() }]);
  const first = await getRecipe(item, { dataDir, ask: s.ask });
  assert.equal(first.source, 'generated');
  assert.equal(first.recipe.title, 'Invoice maker');
  const second = await getRecipe(item, { dataDir, ask: s.ask });
  assert.equal(second.source, 'cache');
  assert.deepEqual(second.recipe, first.recipe);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].system, SYSTEM_PROMPT);
  assert.match(s.calls[0].prompt, /<plugin_instructions>[\s\S]*Makes invoices[\s\S]*<\/plugin_instructions>/);
  assert.ok(s.calls[0].schema);
});

test('regenerates when the plugin file changes', async () => {
  const { item, dataDir } = await setup();
  const s = scripted([{ ok: true, text: '', structured: goodRecipe() }, { ok: true, text: '', structured: { ...goodRecipe(), title: 'Changed' } }]);
  await getRecipe(item, { dataDir, ask: s.ask });
  await writeFile(item.file, '---\nname: invoice-maker\ndescription: New text\n---\n'); // test fixture in temp dir, not real config
  const r = await getRecipe(item, { dataDir, ask: s.ask });
  assert.equal(r.source, 'generated');
  assert.equal(r.recipe.title, 'Changed');
  assert.equal(s.calls.length, 2);
});

test('retries with the validation errors, then succeeds', async () => {
  const { item, dataDir } = await setup();
  const bad = { ...goodRecipe(), version: 7 };
  const s = scripted([{ ok: true, text: '', structured: bad }, { ok: true, text: 'Here it is: ' + JSON.stringify(goodRecipe()) }]);
  const r = await getRecipe(item, { dataDir, ask: s.ask });
  assert.equal(r.source, 'generated');
  assert.equal(s.calls.length, 2);
  assert.match(s.calls[1].prompt, /version must be one of/);
  assert.match(s.calls[1].prompt, /"version":7/);
});

test('falls back to a text box after 2 failed retries, and does not cache it', async () => {
  const { item, dataDir } = await setup();
  const bad: CliResult = { ok: true, text: 'not json at all' };
  const s = scripted([bad, bad, bad]);
  const r = await getRecipe(item, { dataDir, ask: s.ask });
  assert.equal(s.calls.length, 3, '1 try + 2 retries');
  assert.equal(r.source, 'fallback');
  assert.equal(r.recipe.screens[0].fields[0].type, 'longtext');
  assert.ok(r.notice);
  assert.deepEqual(await readdir(dataDir), [], 'nothing cached');
});

test('does not retry when the CLI itself fails, and passes its message on', async () => {
  const { item, dataDir } = await setup();
  const s = scripted([{ ok: false, message: 'Claude is not signed in.' }]);
  const r = await getRecipe(item, { dataDir, ask: s.ask });
  assert.equal(s.calls.length, 1);
  assert.equal(r.source, 'fallback');
  assert.equal(r.notice, 'Claude is not signed in.');
});

test('two requests at once share one AI call', async () => {
  const { item, dataDir } = await setup();
  const s = scripted([{ ok: true, text: '', structured: goodRecipe() }]);
  const [a, b] = await Promise.all([getRecipe(item, { dataDir, ask: s.ask }), getRecipe(item, { dataDir, ask: s.ask })]);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(a, b);
});
