// "Connect your AI": checks, installs (when we can) and signs in the official Claude Code or Codex program, so users never need a terminal.
// Install uses the provider's official installer. Sign-in is the provider's own browser flow; we never see or store tokens.
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { PROVIDERS, installCommand, type ProviderId } from './providers.ts';

export { installCommand };

export type JobState = 'idle' | 'running' | 'failed';

export interface SetupStatus {
  installed: boolean;
  signedIn: boolean;
  install: { state: JobState; message?: string };
  signin: { state: JobState; message?: string; url?: string; needsCode?: boolean };
}

interface Jobs {
  install: SetupStatus['install'];
  signin: SetupStatus['signin'];
  signinChild: ChildProcess | null;
}

const jobs = new Map<ProviderId, Jobs>();
function jobsFor(id: ProviderId): Jobs {
  let j = jobs.get(id);
  if (!j) jobs.set(id, (j = { install: { state: 'idle' }, signin: { state: 'idle' }, signinChild: null }));
  return j;
}

/** Runs the provider's status command and asks it whether someone is signed in. Reads nothing else. */
async function check(id: ProviderId): Promise<{ installed: boolean; signedIn: boolean }> {
  const p = PROVIDERS[id];
  const found = await p.find();
  if (!found) return { installed: false, signedIn: false };
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(found.cmd, [...found.args, ...p.statusArgs], { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => child.kill(), 20_000);
    const keep = (c: Buffer) => (out = (out + c).slice(-8000));
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', () => resolve({ installed: false, signedIn: false }));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ installed: true, signedIn: p.isSignedIn(code, out) });
    });
  });
}

export async function getStatus(id: ProviderId = 'claude'): Promise<SetupStatus> {
  const j = jobsFor(id);
  const s = await check(id);
  if (s.signedIn && j.signinChild) {
    j.signinChild.kill(); // done: the sign-in helper is no longer needed
    j.signinChild = null;
  }
  if (s.signedIn) j.signin = { state: 'idle' };
  return { ...s, install: j.install, signin: j.signin };
}

/** Starts the official installer in the background. The screen polls getStatus() for progress. Only for providers that have one. */
export function startInstall(command?: { cmd: string; args: string[] }, id: ProviderId = 'claude'): void {
  const p = PROVIDERS[id];
  const j = jobsFor(id);
  const cmd = command ?? p.installCommand?.();
  if (!cmd || j.install.state === 'running') return;
  j.install = { state: 'running' };
  let log = '';
  const child = spawn(cmd.cmd, cmd.args, { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const timer = setTimeout(() => child.kill(), 10 * 60_000);
  const keep = (c: Buffer) => (log = (log + c).slice(-4000));
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const fail = (why: string) => {
    console.error('[install]', why, log.trim().slice(-1500)); // details for troubleshooting stay in the terminal
    j.install = { state: 'failed', message: `${p.label} couldn't be installed. Check your internet connection and try again. If it keeps failing, see Troubleshooting in the README.` };
  };
  child.on('error', (err) => {
    clearTimeout(timer);
    fail(err.message);
  });
  child.on('close', async (code) => {
    clearTimeout(timer);
    if (code !== 0) return fail(`exit code ${code}`);
    // The installer may succeed but put the program somewhere we can't find yet.
    if (!(await p.find())) return fail('installed, but the program was not found afterwards');
    j.install = { state: 'idle' };
  });
}

/** Starts the provider's own sign-in. It opens the browser; if it prints a link or asks for a code, the screen shows those. */
export async function startSignin(id: ProviderId = 'claude'): Promise<void> {
  const p = PROVIDERS[id];
  const j = jobsFor(id);
  if (j.signinChild) return;
  const found = await p.find();
  if (!found) {
    j.signin = { state: 'failed', message: `Install ${p.label} first.` };
    return;
  }
  j.signin = { state: 'running' };
  let out = '';
  const child = spawn(found.cmd, [...found.args, ...p.loginArgs], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  j.signinChild = child;
  const timer = setTimeout(() => child.kill(), 15 * 60_000);
  // Output is read only for the sign-in link and a code prompt. It is never logged.
  const read = (c: Buffer) => {
    out = (out + c).slice(-8000);
    const url = /https:\/\/[^\s"'<>]+/.exec(out)?.[0];
    if (url && p.loginSites.test(url)) j.signin.url = url;
    if (/paste|enter (the )?code|authorization code/i.test(out)) j.signin.needsCode = true;
  };
  child.stdout?.on('data', read);
  child.stderr?.on('data', read);
  child.stdin?.on('error', () => {});
  child.on('error', () => {
    j.signin = { state: 'failed', message: `Plugboard couldn't start the ${p.label} sign-in. Please try again.` };
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (j.signinChild === child) j.signinChild = null;
    if (j.signin.state === 'running') j.signin = code === 0 ? { state: 'idle' } : { state: 'failed', message: "Sign-in didn't finish. Click Sign in to try again." };
  });
}

/** Passes the code from the sign-in page to the waiting sign-in process. */
export function sendSigninCode(code: string, id: ProviderId = 'claude'): boolean {
  const child = jobsFor(id).signinChild;
  const clean = code.trim();
  if (!child?.stdin || !clean || clean.length > 2000 || /[\r\n]/.test(clean)) return false;
  child.stdin.write(clean + '\n');
  return true;
}

/** Tests only. */
export function resetSetupForTests() {
  for (const j of jobs.values()) j.signinChild?.kill();
  jobs.clear();
}
