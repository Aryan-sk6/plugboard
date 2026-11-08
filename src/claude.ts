// Claude Code adapter: runs the user's own installed, unmodified `claude` program, exactly as they could themselves.
// We never read, copy or pass sign-in tokens; the CLI handles its own sign-in.
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, delimiter, extname } from 'node:path';

export type CliResult =
  | { ok: true; text: string; structured?: unknown }
  | { ok: false; message: string };

/** Live progress while the AI works: answer text as it arrives, or a character count for structured answers. */
export type Progress = { type: 'text'; text: string } | { type: 'working'; chars: number };

export interface AskOptions {
  system: string;
  prompt: string;
  schema?: object;
  timeoutMs?: number;
  /** When set, output is streamed and progress is reported. */
  onProgress?: (p: Progress) => void;
  /** Aborting stops the CLI. */
  signal?: AbortSignal;
}

export const NOT_FOUND = "Claude isn't set up on this computer yet. Go to Connect Claude to set it up.";
export const NOT_SIGNED_IN = "Claude isn't signed in. Go to Connect Claude to sign in.";
export const STOPPED = 'Stopped. Nothing else was done.';

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
    ...(opts.onProgress ? ['--output-format', 'stream-json', '--verbose', '--include-partial-messages'] : ['--output-format', 'json']),
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

/** Reads the CLI's final result object (same shape in json and stream-json modes). */
function fromResult(data: any): CliResult {
  // A failed call can still say subtype "success", so is_error is the field to trust.
  if (data.is_error || (typeof data.subtype === 'string' && data.subtype.startsWith('error'))) {
    return { ok: false, message: friendlyError(String(data.result ?? data.subtype ?? 'unknown error')) };
  }
  return { ok: true, text: String(data.result ?? ''), structured: data.structured_output };
}

/** Sends one request to Claude. The prompt goes through stdin (Windows limits command lines to ~32k characters). */
export async function askClaude(opts: AskOptions): Promise<CliResult> {
  if (opts.signal?.aborted) return { ok: false, message: STOPPED };
  const found = await findClaude();
  if (!found) return { ok: false, message: NOT_FOUND };
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let pending = ''; // partial line in streaming mode
    let final: CliResult | null = null;
    let jsonChars = 0;
    let why: 'timeout' | 'stopped' | null = null;
    // Neutral working folder so no project files (CLAUDE.md etc.) get picked up.
    const child = spawn(found.cmd, [...found.args, ...claudeArgs(opts)], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stop = (reason: 'timeout' | 'stopped') => {
      why = reason;
      child.kill();
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const onAbort = () => stop('stopped');
    opts.signal?.addEventListener('abort', onAbort);

    // Streaming lines are parsed but never logged: the result line carries account details.
    const onLine = (line: string) => {
      if (!line.trim()) return;
      let d: any;
      try {
        d = JSON.parse(line);
      } catch {
        return;
      }
      if (d.type === 'result') final = fromResult(d);
      const delta = d.type === 'stream_event' && d.event?.type === 'content_block_delta' ? d.event.delta : null;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') opts.onProgress?.({ type: 'text', text: delta.text });
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        jsonChars += delta.partial_json.length;
        opts.onProgress?.({ type: 'working', chars: jsonChars });
      }
    };

    child.stdout.on('data', (c) => {
      if (!opts.onProgress) return void (stdout += c);
      const lines = (pending + c).split('\n');
      pending = lines.pop() ?? '';
      lines.forEach(onLine);
    });
    child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-4000)));
    child.stdin.on('error', () => {}); // child may exit before reading stdin; the close handler reports it
    const finish = (r: CliResult) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    child.on('error', (err: NodeJS.ErrnoException) => finish({ ok: false, message: err.code === 'ENOENT' ? NOT_FOUND : `Plugboard couldn't start Claude: ${err.message}` }));
    child.on('close', (code) => {
      if (why === 'stopped') return finish({ ok: false, message: STOPPED });
      if (why === 'timeout') return finish({ ok: false, message: `Claude took too long to answer (over ${Math.round(timeoutMs / 60_000)} minutes). Please try again.` });
      if (opts.onProgress) {
        onLine(pending);
        if (final) return finish(final);
      } else {
        try {
          return finish(fromResult(JSON.parse(stdout)));
        } catch {
          // fall through
        }
      }
      if (stderr.trim()) console.error('[claude stderr]', stderr.trim().slice(0, 2000));
      const hint = /not logged in|login/i.test(stdout + stderr) ? NOT_SIGNED_IN : `Claude stopped unexpectedly (code ${code}). Please try again.`;
      finish({ ok: false, message: hint });
    });
    child.stdin.end(opts.prompt);
  });
}
