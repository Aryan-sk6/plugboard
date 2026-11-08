// "Connect Claude": checks, installs and signs in the official Claude Code program so users never need a terminal.
// Install uses Anthropic's official installer. Sign-in is Anthropic's own browser flow; we never see or store tokens.
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { findClaude } from './claude.ts';

export type JobState = 'idle' | 'running' | 'failed';

export interface SetupStatus {
  installed: boolean;
  signedIn: boolean;
  install: { state: JobState; message?: string };
  signin: { state: JobState; message?: string; url?: string; needsCode?: boolean };
}

/** Anthropic's official install command for this computer (from code.claude.com/docs/en/setup). */
export function installCommand(platform = process.platform): { cmd: string; args: string[] } {
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'irm https://claude.ai/install.ps1 | iex'] };
  return { cmd: 'bash', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] };
}

let install: SetupStatus['install'] = { state: 'idle' };
let signin: SetupStatus['signin'] = { state: 'idle' };
let signinChild: ChildProcess | null = null;

/** Runs `claude auth status` and reads only the loggedIn field. */
async function isSignedIn(): Promise<{ installed: boolean; signedIn: boolean }> {
  const found = await findClaude();
  if (!found) return { installed: false, signedIn: false };
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(found.cmd, [...found.args, 'auth', 'status', '--json'], { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const timer = setTimeout(() => child.kill(), 20_000);
    child.stdout.on('data', (c) => (out += c));
    child.on('error', () => resolve({ installed: false, signedIn: false }));
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve({ installed: true, signedIn: JSON.parse(out).loggedIn === true });
      } catch {
        resolve({ installed: true, signedIn: false });
      }
    });
  });
}

export async function getStatus(): Promise<SetupStatus> {
  const s = await isSignedIn();
  if (s.signedIn && signinChild) {
    signinChild.kill(); // done: the sign-in helper is no longer needed
    signinChild = null;
  }
  if (s.signedIn) signin = { state: 'idle' };
  return { ...s, install, signin };
}

/** Starts the official installer in the background. The screen polls getStatus() for progress. */
export function startInstall(command = installCommand()): void {
  if (install.state === 'running') return;
  install = { state: 'running' };
  let log = '';
  const child = spawn(command.cmd, command.args, { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const timer = setTimeout(() => child.kill(), 10 * 60_000);
  const keep = (c: Buffer) => (log = (log + c).slice(-4000));
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const fail = (why: string) => {
    console.error('[install]', why, log.trim().slice(-1500)); // details for troubleshooting stay in the terminal
    install = { state: 'failed', message: "Claude couldn't be installed. Check your internet connection and try again. If it keeps failing, see Troubleshooting in the README." };
  };
  child.on('error', (err) => {
    clearTimeout(timer);
    fail(err.message);
  });
  child.on('close', async (code) => {
    clearTimeout(timer);
    if (code !== 0) return fail(`exit code ${code}`);
    // The installer may succeed but put claude somewhere we can't find yet.
    if (!(await findClaude())) return fail('installed, but claude was not found afterwards');
    install = { state: 'idle' };
  });
}

/** Starts Anthropic's sign-in. It opens the browser; if it prints a link or asks for a code, the screen shows those. */
export async function startSignin(): Promise<void> {
  if (signinChild) return;
  const found = await findClaude();
  if (!found) {
    signin = { state: 'failed', message: 'Install Claude first.' };
    return;
  }
  signin = { state: 'running' };
  let out = '';
  const child = spawn(found.cmd, [...found.args, 'auth', 'login', '--claudeai'], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  signinChild = child;
  const timer = setTimeout(() => child.kill(), 15 * 60_000);
  // Output is read only for the sign-in link and a code prompt. It is never logged.
  const read = (c: Buffer) => {
    out = (out + c).slice(-8000);
    const url = /https:\/\/[^\s"'<>]+/.exec(out)?.[0];
    if (url && /^https:\/\/([a-z0-9-]+\.)*(claude\.ai|claude\.com|anthropic\.com)\//i.test(url)) signin.url = url;
    if (/paste|enter (the )?code|authorization code/i.test(out)) signin.needsCode = true;
  };
  child.stdout?.on('data', read);
  child.stderr?.on('data', read);
  child.stdin?.on('error', () => {});
  child.on('error', () => {
    signin = { state: 'failed', message: "Plugboard couldn't start the Claude sign-in. Please try again." };
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (signinChild === child) signinChild = null;
    if (signin.state === 'running') signin = code === 0 ? { state: 'idle' } : { state: 'failed', message: "Sign-in didn't finish. Click Sign in to try again." };
  });
}

/** Passes the code from Anthropic's sign-in page to the waiting sign-in process. */
export function sendSigninCode(code: string): boolean {
  const clean = code.trim();
  if (!signinChild?.stdin || !clean || clean.length > 2000 || /[\r\n]/.test(clean)) return false;
  signinChild.stdin.write(clean + '\n');
  return true;
}

/** Tests only. */
export function resetSetupForTests() {
  signinChild?.kill();
  signinChild = null;
  install = { state: 'idle' };
  signin = { state: 'idle' };
}
