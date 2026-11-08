// Uses the fake CLI (test/fake-claude.mjs) and a fake installer. Checks the setup flow, not real installs or accounts.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStatus, startInstall, startSignin, sendSigninCode, installCommand, resetSetupForTests } from '../src/setup.ts';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const until = async (fn: () => Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
};

beforeEach(async () => {
  resetSetupForTests();
  process.env.PLUGBOARD_CLAUDE_PATH = FAKE;
  process.env.FAKE_STATE = join(await mkdtemp(join(tmpdir(), 'plugboard-auth-')), 'state');
  delete process.env.FAKE_LOGIN;
});

test('uses the official install command for each system', () => {
  assert.deepEqual(installCommand('win32').args.at(-1), 'irm https://claude.ai/install.ps1 | iex');
  assert.deepEqual(installCommand('darwin'), { cmd: 'bash', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] });
  assert.deepEqual(installCommand('linux'), installCommand('darwin'));
});

test('reports not installed, then installed but signed out, then signed in', async () => {
  process.env.PLUGBOARD_CLAUDE_PATH = join(tmpdir(), 'no-claude-here.exe');
  assert.deepEqual(await getStatus(), { installed: false, signedIn: false, install: { state: 'idle' }, signin: { state: 'idle' } });
  process.env.PLUGBOARD_CLAUDE_PATH = FAKE;
  assert.equal((await getStatus()).signedIn, false);
  await writeFile(process.env.FAKE_STATE!, '1');
  assert.equal((await getStatus()).signedIn, true);
});

test('sign-in via browser: exposes the link and finishes', async () => {
  await startSignin();
  await until(async () => !!(await getStatus()).signin.url || (await getStatus()).signedIn);
  await until(async () => (await getStatus()).signedIn);
});

test('sign-in with a pasted code', async () => {
  process.env.FAKE_LOGIN = 'code';
  await startSignin();
  await until(async () => (await getStatus()).signin.needsCode === true);
  const s = await getStatus();
  assert.equal(s.signin.url, 'https://claude.ai/oauth/authorize?code=true&state=abc');
  assert.equal(sendSigninCode('bad\ncode'), false, 'multi-line input is refused');
  assert.equal(sendSigninCode('  good-code '), true);
  await until(async () => (await getStatus()).signedIn);
});

test('a failed sign-in gives a plain message', async () => {
  process.env.FAKE_LOGIN = 'code';
  await startSignin();
  await until(async () => (await getStatus()).signin.needsCode === true);
  sendSigninCode('wrong');
  await until(async () => (await getStatus()).signin.state === 'failed');
  assert.match((await getStatus()).signin.message!, /didn't finish/);
});

test('installer success and failure', async () => {
  startInstall({ cmd: process.execPath, args: ['-e', 'setTimeout(() => process.exit(0), 1500)'] });
  assert.equal((await getStatus()).install.state, 'running');
  await until(async () => (await getStatus()).install.state === 'idle');
  startInstall({ cmd: process.execPath, args: ['-e', 'process.exit(3)'] });
  await until(async () => (await getStatus()).install.state === 'failed');
  assert.match((await getStatus()).install.message!, /couldn't be installed/);
});
