// Uses a fake CLI (test/fake-codex.mjs). These tests check our plumbing and safety flags, not the real Codex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { askCodex, codexArgs, strictSchema, stripNulls, findCodex, DISABLED_FEATURES, CODEX_NOT_FOUND, CODEX_NOT_SIGNED_IN } from '../src/codex.ts';
import { STOPPED, type Progress } from '../src/claude.ts';
import { RECIPE_SCHEMA, schemaForModel, validateRecipe } from '../src/recipe.ts';
import { goodRecipe } from './fixture.ts';

const FAKE = fileURLToPath(new URL('./fake-codex.mjs', import.meta.url));

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}
const run = (mode: string, extra: Record<string, string> = {}, opts: Parameters<typeof askCodex>[0] = { system: 'SYS', prompt: 'hello' }) =>
  withEnv({ PLUGBOARD_CODEX_PATH: FAKE, FAKE_MODE: mode, ...extra }, () => askCodex(opts));

test('every run is read-only, never asks for approval, ignores personal settings and switches risky features off', () => {
  const args = codexArgs();
  assert.equal(args[0], 'exec');
  for (const flag of ['--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('-s') + 1], 'read-only');
  assert.equal(args[args.indexOf('-c') + 1], 'web_search="disabled"');
  assert.equal(args.at(-1), '-', 'the prompt comes through stdin');
  const off = args.flatMap((a, i) => (a === '--disable' ? [args[i + 1]] : []));
  assert.deepEqual(off, DISABLED_FEATURES);
  for (const must of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'browser_use', 'computer_use', 'hooks']) assert.ok(off.includes(must), must);
  for (const never of ['--dangerously-bypass-approvals-and-sandbox', '--full-auto', '--yolo', 'danger-full-access', 'workspace-write', '--enable']) assert.ok(!args.includes(never), never);
  assert.ok(!args.includes('--output-schema'));
  assert.deepEqual(codexArgs('/x/schema.json').slice(-3), ['--output-schema', '/x/schema.json', '-']);
});

test('the prompt, an empty private work folder and a strict schema reach the program; the folder is removed afterwards', async () => {
  const schema = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'], additionalProperties: false };
  const r = await run('echo', {}, { system: 'SYS "quoted"', prompt: 'x'.repeat(50_000), schema });
  assert.ok(r.ok);
  const seen = JSON.parse(r.text);
  assert.equal(seen.stdin, 'SYS "quoted"\n\n' + 'x'.repeat(50_000));
  assert.deepEqual(seen.cwdFiles, [], 'the AI starts in an empty folder');
  assert.ok(seen.cwd.startsWith(tmpdir()) || seen.cwd.toLowerCase().startsWith(tmpdir().toLowerCase()));
  assert.deepEqual(seen.schema.required, ['a', 'b']);
  assert.deepEqual(seen.schema.properties.b.type, ['string', 'null']);
  assert.ok(!existsSync(seen.cwd), 'temporary folder cleaned up');
});

test('strict schema: everything required, optional things may be null, size limits dropped, and the real recipe schema complies', () => {
  const check = (s: any, path = 'root') => {
    if (s && typeof s === 'object') {
      if (s.properties) {
        assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${path} lists every property as required`);
        assert.equal(s.additionalProperties, false, `${path} forbids extra properties`);
        for (const [k, v] of Object.entries(s.properties)) check(v, `${path}.${k}`);
      }
      if (s.items) check(s.items, `${path}[]`);
      for (const bad of ['minItems', 'maxItems', 'minLength', 'maxLength', 'pattern']) assert.ok(!(bad in s), `${path} has no ${bad}`);
    }
  };
  check(strictSchema(schemaForModel(RECIPE_SCHEMA as any)));
  const s = strictSchema(schemaForModel(RECIPE_SCHEMA as any)) as any;
  const type = s.properties.screens.items.properties.fields.items.properties.type;
  assert.ok(!type.enum.includes(null), 'required fields keep their exact choices');
  const kind = s.properties.screens.items.properties.actions.items.properties.kind;
  assert.deepEqual(kind.type, ['string', 'null']);
  assert.ok(kind.enum.includes(null), 'optional choices may be null');
});

test('null placeholders are removed so the answer passes the normal recipe checks', async () => {
  const withNulls = JSON.parse(JSON.stringify(goodRecipe()));
  withNulls.screens[0].intro = null;
  withNulls.screens[0].fields[0].help = null;
  withNulls.screens[0].actions[0].kind = null;
  assert.ok(validateRecipe(withNulls).length > 0, 'nulls alone would fail the checks');
  const r = await run('reply', { FAKE_CODEX_REPLY: JSON.stringify(withNulls) }, { system: 's', prompt: 'p', schema: schemaForModel(RECIPE_SCHEMA as any) });
  assert.ok(r.ok);
  assert.deepEqual(validateRecipe(r.structured), []);
  assert.deepEqual(stripNulls({ a: null, b: [{ c: null, d: 1 }], e: 'x' }), { b: [{ d: 1 }], e: 'x' });
});

test('plain answers come back as text, and the last message wins', async () => {
  assert.deepEqual(await run('reply', { FAKE_CODEX_REPLY: 'PONG' }), { ok: true, text: 'PONG', structured: undefined });
  const two = await run('two');
  assert.ok(two.ok && two.text === 'Final answer.');
});

test('not-JSON answers to a structured request still come back as text for the caller to handle', async () => {
  const r = await run('reply', { FAKE_CODEX_REPLY: 'sorry, here is prose' }, { system: 's', prompt: 'p', schema: { type: 'object', properties: {}, additionalProperties: false } });
  assert.deepEqual(r, { ok: true, text: 'sorry, here is prose', structured: undefined });
});

test('progress is reported when a message arrives', async () => {
  const seen: Progress[] = [];
  await withEnv({ PLUGBOARD_CODEX_PATH: FAKE, FAKE_MODE: 'reply', FAKE_CODEX_REPLY: 'abc' }, () => askCodex({ system: 's', prompt: 'p', onProgress: (p) => seen.push(p) }));
  assert.deepEqual(seen, [{ type: 'working', chars: 3 }]);
});

test('failures become plain messages; a failure beats partial text', async () => {
  assert.deepEqual(await run('failed', { FAKE_CODEX_ERROR: 'unexpected status 401 Unauthorized' }), { ok: false, message: CODEX_NOT_SIGNED_IN });
  assert.deepEqual(await run('error', { FAKE_CODEX_ERROR: 'Not logged in. Please log in again.' }), { ok: false, message: CODEX_NOT_SIGNED_IN });
  const limit = await run('failed', { FAKE_CODEX_ERROR: "You've hit your usage limit. Try again at 5pm." });
  assert.ok(!limit.ok && limit.message.includes('usage limit') && limit.message.startsWith('ChatGPT'), "the provider's limit message is shown as-is");
  const none = await run('nomessage');
  assert.ok(!none.ok && /stopped unexpectedly/.test(none.message));
});

test('timeout and Stop kill the program and say so plainly', async () => {
  const slow = await run('hang', {}, { system: 's', prompt: 'p', timeoutMs: 500 });
  assert.ok(!slow.ok && /too long/.test(slow.message) && slow.message.startsWith('ChatGPT'));
  const stop = new AbortController();
  const r = await run('hang', {}, { system: 's', prompt: 'p', signal: stop.signal, onProgress: () => stop.abort() });
  assert.deepEqual(r, { ok: false, message: STOPPED });
  const early = new AbortController();
  early.abort();
  assert.deepEqual(await run('echo', {}, { system: 's', prompt: 'p', signal: early.signal }), { ok: false, message: STOPPED });
});

test('a missing program is reported plainly', async () => {
  const r = await withEnv({ PLUGBOARD_CODEX_PATH: join(tmpdir(), 'no-such-codex.exe') }, () => askCodex({ system: 's', prompt: 'p' }));
  assert.deepEqual(r, { ok: false, message: CODEX_NOT_FOUND });
  assert.equal(await withEnv({ PLUGBOARD_CODEX_PATH: FAKE }, () => findCodex()).then((f) => f?.args.at(-1)), FAKE);
});
