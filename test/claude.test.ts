// Uses a fake CLI (test/fake-claude.mjs). These tests check our plumbing, not the real Claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askClaude, findClaude, claudeArgs, NOT_FOUND, NOT_SIGNED_IN, STOPPED, type Progress } from '../src/claude.ts';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

const opts = { system: 'SYS "quoted" text', prompt: 'hello ' + 'x'.repeat(50_000), schema: { type: 'object', properties: { a: { type: 'string' } } } };

test('passes safe flags as separate args and the prompt via stdin, even when long', async () => {
  const r = await withEnv({ PLUGBOARD_CLAUDE_PATH: FAKE, FAKE_MODE: 'echo' }, () => askClaude(opts));
  assert.ok(r.ok);
  const { args, stdin } = JSON.parse(r.text);
  assert.equal(stdin, opts.prompt);
  for (const flag of ['-p', '--safe-mode', '--strict-mcp-config', '--no-session-persistence']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--output-format') + 1], 'json');
  assert.equal(args[args.indexOf('--system-prompt') + 1], opts.system);
  assert.deepEqual(JSON.parse(args[args.indexOf('--json-schema') + 1]), opts.schema);
  assert.ok(!args.includes('--bare'), '--bare would ignore the subscription sign-in');
});

test('returns structured output', async () => {
  const r = await withEnv({ PLUGBOARD_CLAUDE_PATH: FAKE, FAKE_MODE: 'structured' }, () => askClaude(opts));
  assert.deepEqual(r, { ok: true, text: '', structured: { ok: true } });
});

test('turns CLI failures into plain messages', async () => {
  const run = (mode: string, timeoutMs?: number) => withEnv({ PLUGBOARD_CLAUDE_PATH: FAKE, FAKE_MODE: mode }, () => askClaude({ ...opts, timeoutMs }));
  assert.deepEqual(await run('notlogged'), { ok: false, message: NOT_SIGNED_IN });
  const limit = await run('limit');
  assert.ok(!limit.ok && limit.message.includes('usage limit'), 'provider limit message is shown as-is');
  const garbage = await run('garbage');
  assert.ok(!garbage.ok && /stopped unexpectedly/.test(garbage.message));
  const hang = await run('hang', 500);
  assert.ok(!hang.ok && /too long/.test(hang.message));
});

test('reports a missing CLI plainly', async () => {
  const r = await withEnv({ PLUGBOARD_CLAUDE_PATH: join(tmpdir(), 'no-such-claude.exe') }, () => askClaude(opts));
  assert.deepEqual(r, { ok: false, message: NOT_FOUND });
});

test('resolves a Windows npm .cmd shim to its real target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plugboard-shim-'));
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'pkg', 'cli.js'), '');
  await writeFile(join(dir, 'claude.cmd'), '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\pkg\\cli.js" %*\r\n');
  const found = await withEnv({ PLUGBOARD_CLAUDE_PATH: join(dir, 'claude.cmd') }, () => findClaude());
  assert.deepEqual(found, { cmd: process.execPath, args: [join(dir, 'node_modules', 'pkg', 'cli.js')] });
});

test('streaming mode reports live text and progress, then the final result', async () => {
  const seen: Progress[] = [];
  const r = await withEnv({ PLUGBOARD_CLAUDE_PATH: FAKE, FAKE_MODE: 'stream' }, () => askClaude({ ...opts, onProgress: (p) => seen.push(p) }));
  assert.deepEqual(r, { ok: true, text: 'Hello there', structured: undefined });
  assert.deepEqual(seen, [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }, { type: 'working', chars: 5 }]);
});

test('streaming uses stream-json with --verbose and partial messages', () => {
  const args = claudeArgs({ ...opts, onProgress: () => {} });
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(args.includes('--verbose') && args.includes('--include-partial-messages'));
});

test('Stop kills the CLI and says so plainly', async () => {
  const stop = new AbortController();
  const r = await withEnv({ PLUGBOARD_CLAUDE_PATH: FAKE, FAKE_MODE: 'streamhang' }, () => askClaude({ ...opts, signal: stop.signal, onProgress: () => stop.abort() }));
  assert.deepEqual(r, { ok: false, message: STOPPED });
});
