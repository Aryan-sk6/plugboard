// Claude Code adapter: runs the user's own installed, unmodified `claude` program, exactly as they could themselves.
// We never read, copy or pass sign-in tokens; the CLI handles its own sign-in.
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, delimiter, extname } from 'node:path';

export type CliResult =
  | { ok: true; text: string; structured?: unknown }
  | { ok: false; message: string };

export interface AskOptions {
  system: string;
  prompt: string;
  schema?: object;
  timeoutMs?: number;
}

export const NOT_FOUND = "Plugboard couldn't find Claude on this computer. Install Claude Code (see the README), then try again.";
export const NOT_SIGNED_IN = "Claude isn't signed in yet. Open a terminal, type claude, press Enter and follow the steps to sign in. Then try again.";

async function exists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** How to start a file: .js runs with this Node, a Windows npm .cmd shim runs its real target (spawning .cmd needs a shell, which mangles JSON args). */
async function launcher(file: string): Promise<{ cmd: string; args: string[] } | null> {
  const ext = extname(file).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return { cmd: process.execPath, args: [file] };
  if (ext === '.cmd' || ext === '.bat') {
    const text = await readFile(file, 'utf8').catch(() => '');
    const m = /"%~?dp0%?\\([^"]+?\.(?:js|cjs|mjs|exe))"/i.exec(text);
    if (!m) return null;
    return launcher(join(dirname(file), m[1]));
  }
  return { cmd: file, args: [] };
}

/** Finds the claude program: PLUGBOARD_CLAUDE_PATH, then PATH, then the native installer's folder. */
export async function findClaude(): Promise<{ cmd: string; args: string[] } | null> {
  if (process.env.PLUGBOARD_CLAUDE_PATH) return launcher(process.env.PLUGBOARD_CLAUDE_PATH);
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const dirs = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), join(homedir(), '.local', 'bin')];
  for (const dir of dirs) {
    for (const name of names) {
      const p = join(dir, name);
      if (await exists(p)) {
        const l = await launcher(p);
        if (l) return l;
      }
    }
  }
  return null;
}

/** Arguments for a plain text answer: no tools, no plugins, hooks, MCP or saved session. */
export function claudeArgs(opts: AskOptions): string[] {
  const args = [
    '-p',
    '--output-format', 'json',
    '--safe-mode',
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--system-prompt', opts.system,
  ];
  if (opts.schema) args.push('--json-schema', JSON.stringify(opts.schema));
  return args;
}

/** Turns the CLI's reply text into a plain message for people. */
function friendlyError(text: string): string {
  if (/not logged in|please run \/login|invalid api key|authentication/i.test(text)) return NOT_SIGNED_IN;
  return `Claude couldn't finish this request. Claude said: ${text.slice(0, 400)}`;
}

/** Sends one request to Claude. The prompt goes through stdin (Windows limits command lines to ~32k characters). */
export async function askClaude(opts: AskOptions): Promise<CliResult> {
  const found = await findClaude();
  if (!found) return { ok: false, message: NOT_FOUND };
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    // Neutral working folder so no project files (CLAUDE.md etc.) get picked up.
    const child = spawn(found.cmd, [...found.args, ...claudeArgs(opts)], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.stdin.on('error', () => {}); // child may exit before reading stdin; the close handler reports it
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ ok: false, message: err.code === 'ENOENT' ? NOT_FOUND : `Plugboard couldn't start Claude: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ ok: false, message: `Claude took too long to answer (over ${Math.round(timeoutMs / 60_000)} minutes). Please try again.` });
      let data: any;
      try {
        data = JSON.parse(stdout);
      } catch {
        if (stderr.trim()) console.error('[claude stderr]', stderr.trim().slice(0, 2000));
        const hint = /not logged in|login/i.test(stdout + stderr) ? NOT_SIGNED_IN : `Claude stopped unexpectedly (code ${code}). Please try again.`;
        return resolve({ ok: false, message: hint });
      }
      // A failed call can still say subtype "success", so is_error is the field to trust.
      if (data.is_error || (typeof data.subtype === 'string' && data.subtype.startsWith('error'))) {
        return resolve({ ok: false, message: friendlyError(String(data.result ?? data.subtype ?? 'unknown error')) });
      }
      resolve({ ok: true, text: String(data.result ?? ''), structured: data.structured_output });
    });
    child.stdin.end(opts.prompt);
  });
}
