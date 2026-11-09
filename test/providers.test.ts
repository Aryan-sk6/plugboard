import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROVIDERS, isProviderId } from '../src/providers.ts';
import { readProvider, writeProvider } from '../src/settings.ts';

test('both AIs are listed with plain names, and only real ids are accepted', () => {
  assert.deepEqual(Object.values(PROVIDERS).map((p) => [p.id, p.label]), [['claude', 'Claude'], ['codex', 'ChatGPT']]);
  assert.ok(isProviderId('codex') && isProviderId('claude'));
  for (const bad of ['', 'gpt', 'CLAUDE', null, undefined, 3, {}]) assert.ok(!isProviderId(bad), String(bad));
});

test('sign-in is read from each program the way that program reports it', () => {
  const claude = PROVIDERS.claude;
  assert.equal(claude.isSignedIn(1, '{"loggedIn":true,"authMethod":"claude.ai"}'), true);
  assert.equal(claude.isSignedIn(1, '{"loggedIn":false}'), false);
  assert.equal(claude.isSignedIn(0, 'not json'), false);
  const codex = PROVIDERS.codex;
  assert.equal(codex.isSignedIn(0, 'Logged in using ChatGPT'), true);
  assert.equal(codex.isSignedIn(1, 'Not logged in'), false);
  assert.equal(codex.isSignedIn(0, 'Not logged in'), false, 'the words win even if the exit code is 0');
  assert.equal(codex.isSignedIn(null, ''), false);
});

test('only sign-in links on each provider\'s own sites are ever shown', () => {
  assert.ok(PROVIDERS.claude.loginSites.test('https://claude.ai/oauth/authorize?x=1'));
  assert.ok(PROVIDERS.claude.loginSites.test('https://console.anthropic.com/login'));
  assert.ok(!PROVIDERS.claude.loginSites.test('https://auth.openai.com/oauth'));
  assert.ok(PROVIDERS.codex.loginSites.test('https://auth.openai.com/oauth/authorize?x=1'));
  assert.ok(PROVIDERS.codex.loginSites.test('https://chatgpt.com/auth'));
  for (const p of Object.values(PROVIDERS)) {
    for (const evil of ['https://evil.example/claude.ai/', 'https://claude.ai.evil.example/', 'https://openai.com.evil.example/', 'http://claude.ai/x', 'javascript:alert(1)']) {
      assert.ok(!p.loginSites.test(evil), `${p.id} rejects ${evil}`);
    }
  }
});

test('only Claude has an installer Plugboard can run; ChatGPT gets instructions instead', () => {
  assert.ok(PROVIDERS.claude.installCommand);
  assert.equal(PROVIDERS.codex.installCommand, undefined);
  assert.match(PROVIDERS.codex.installHelp.url, /^https:\/\/developers\.openai\.com\//);
  assert.match(PROVIDERS.codex.notice ?? '', /only use helpers you trust/i, 'the reduced-safety note is shown to people');
  assert.equal(PROVIDERS.claude.notice, undefined);
});

test('the chosen AI is saved, survives a restart, and falls back to Claude if the file is missing or damaged', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'pb-settings-')), 'data');
  assert.equal(readProvider(dir), 'claude', 'no file yet');
  writeProvider(dir, 'codex');
  assert.equal(readProvider(dir), 'codex');
  writeProvider(dir, 'claude');
  assert.equal(readProvider(dir), 'claude');
  assert.deepEqual(await readdir(dir), ['settings.json'], 'no temporary file left behind');
  await writeFile(join(dir, 'settings.json'), '{ not json');
  assert.equal(readProvider(dir), 'claude');
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ provider: 'something-else' }));
  assert.equal(readProvider(dir), 'claude');
});
