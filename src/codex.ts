// Codex adapter: runs the user's own installed, unmodified `codex` program (`codex exec`), exactly as they could themselves.
// We never read, copy or pass sign-in tokens; Codex handles its own sign-in.
//
// SAFETY: unlike Claude (`--tools ""`), Codex has no switch that removes every tool. So we layer protections:
// read-only sandbox, never ask to approve anything, the user's own Codex settings ignored (no personal connectors),
// an empty temporary working folder, web search off, and every risky feature switched off (see DISABLED_FEATURES).
// Checked on 2026-11-09 by asking Codex to list its tools and by trying to read a test file with it; the remaining tools
// (apply_patch, sub-agents, an empty MCP lookup, a JavaScript tool with no file access) could not read it. This is
// reduced access, not zero access, so the app and README say so.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { STOPPED, exists, launcher, type AskOptions, type CliResult, type Launch } from './claude.ts';

export const CODEX_NOT_FOUND = "ChatGPT (Codex) isn't set up on this computer yet. Go to Connect your AI to set it up.";
export const CODEX_NOT_SIGNED_IN = "ChatGPT isn't signed in. Go to Connect your AI to sign in.";

/** Codex features that give the model tools or reach beyond plain text. Names come from `codex features list`. */
export const DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'view_image', 'apps', 'plugins', 'remote_plugin', 'browser_use', 'browser_use_external',
  'computer_use', 'multi_agent', 'hooks', 'skill_search', 'image_generation', 'sleep_tool', 'in_app_browser',
  'tool_suggest', 'goals', 'memories',
];

/** Finds the codex program: PLUGBOARD_CODEX_PATH, then PATH, then the Windows desktop app's folder. */
export async function findCodex(): Promise<Launch | null> {
  if (process.env.PLUGBOARD_CODEX_PATH) return launcher(process.env.PLUGBOARD_CODEX_PATH);
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
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
  // shortcut: only the Windows desktop app's folder is searched; other systems rely on PATH. Add more places if people report it.
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const bin = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    const found: { file: string; time: number }[] = [];
    for (const d of await readdir(bin).catch(() => [] as string[])) {
      const file = join(bin, d, 'codex.exe');
      const s = await stat(file).catch(() => null);
      if (s?.isFile()) found.push({ file, time: s.mtimeMs });
    }
    found.sort((a, b) => b.time - a.time);
    if (found[0]) return { cmd: found[0].file, args: [] };
  }
  return null;
}

type Schema = Record<string, any>;

/**
 * OpenAI's structured output wants every property listed as required. Optional ones become "may be null",
 * and size limits are dropped (we check those ourselves). stripNulls() undoes the nulls afterwards.
 */
export function strictSchema(s: Schema): Schema {
  if (!s || typeof s !== 'object') return s;
  const out: Schema = {};
  for (const [k, v] of Object.entries(s)) {
    if (['minItems', 'maxItems', 'minLength', 'maxLength', 'pattern'].includes(k)) continue;
    if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v as Schema).map(([pk, pv]) => [pk, strictSchema(pv)]));
    else if (k === 'items') out[k] = strictSchema(v);
    else out[k] = v;
  }
  if (out.properties) {
    const required = new Set<string>(out.required ?? []);
    for (const key of Object.keys(out.properties)) {
      if (required.has(key)) continue;
      const p = out.properties[key];
      out.properties[key] = { ...p, type: [...new Set([...(Array.isArray(p.type) ? p.type : [p.type]), 'null'])], ...(p.enum ? { enum: [...p.enum, null] } : {}) };
    }
    out.required = Object.keys(out.properties);
  }
  return out;
}

export function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]));
  return v;
}

/** Arguments for a text-only answer. The prompt itself goes in through stdin ("-"). */
export function codexArgs(schemaFile?: string): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '-s', 'read-only'];
  for (const f of DISABLED_FEATURES) args.push('--disable', f);
  args.push('-c', 'web_search="disabled"');
  if (schemaFile) args.push('--output-schema', schemaFile);
  args.push('-');
  return args;
}

function friendlyError(text: string): string {
  if (/not logged in|log ?in again|sign ?in|unauthorized|\b401\b|authentication|token.*(expired|invalid)/i.test(text)) return CODEX_NOT_SIGNED_IN;
  return `ChatGPT couldn't finish this request. It said: ${text.slice(0, 400)}`;
}

/** Sends one request to Codex. Answers arrive all at once (Codex does not stream partial text). */
export async function askCodex(opts: AskOptions): Promise<CliResult> {
  if (opts.signal?.aborted) return { ok: false, message: STOPPED };
  const found = await findCodex();
  if (!found) return { ok: false, message: CODEX_NOT_FOUND };
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  // A private folder per run. The AI works in an empty "work" folder inside it; the schema file sits beside it.
  const dir = await mkdtemp(join(tmpdir(), 'plugboard-codex-'));
  const work = join(dir, 'work');
  await mkdir(work);
  let schemaFile: string | undefined;
  if (opts.schema) {
    schemaFile = join(dir, 'schema.json');
    await writeFile(schemaFile, JSON.stringify(strictSchema(opts.schema)));
  }

  try {
    return await new Promise<CliResult>((resolve) => {
      let pending = '';
      let stderr = '';
      let lastMessage: string | null = null;
      let failure: string | null = null;
      let why: 'timeout' | 'stopped' | null = null;
      const child = spawn(found.cmd, [...found.args, ...codexArgs(schemaFile)], { cwd: work, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const stop = (reason: 'timeout' | 'stopped') => {
        why = reason;
        child.kill();
      };
      const timer = setTimeout(() => stop('timeout'), timeoutMs);
      const onAbort = () => stop('stopped');
      opts.signal?.addEventListener('abort', onAbort);

      // Events are parsed but never logged: they can carry account details.
      const onLine = (line: string) => {
        let d: any;
        try {
          d = JSON.parse(line);
        } catch {
          return;
        }
        if (d.type === 'item.completed' && d.item?.type === 'agent_message' && typeof d.item.text === 'string') {
          lastMessage = d.item.text;
          opts.onProgress?.({ type: 'working', chars: d.item.text.length });
        }
        if (d.type === 'turn.failed' || d.type === 'error') failure = String(d.error?.message ?? d.message ?? 'unknown error');
      };
      child.stdout.on('data', (c) => {
        const lines = (pending + c).split('\n');
        pending = lines.pop() ?? '';
        lines.forEach(onLine);
      });
      child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-4000)));
      child.stdin.on('error', () => {});
      const finish = (r: CliResult) => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        resolve(r);
      };
      child.on('error', (err: NodeJS.ErrnoException) => finish({ ok: false, message: err.code === 'ENOENT' ? CODEX_NOT_FOUND : `Plugboard couldn't start ChatGPT: ${err.message}` }));
      child.on('close', (code) => {
        if (why === 'stopped') return finish({ ok: false, message: STOPPED });
        if (why === 'timeout') return finish({ ok: false, message: `ChatGPT took too long to answer (over ${Math.round(timeoutMs / 60_000)} minutes). Please try again.` });
        onLine(pending);
        // A failure event wins even if some text arrived first.
        if (failure) return finish({ ok: false, message: friendlyError(failure) });
        if (lastMessage === null) {
          if (stderr.trim()) console.error('[codex stderr]', stderr.trim().slice(0, 2000));
          return finish({ ok: false, message: /not logged in|login/i.test(stderr) ? CODEX_NOT_SIGNED_IN : `ChatGPT stopped unexpectedly (code ${code}). Please try again.` });
        }
        let structured: unknown;
        if (opts.schema) {
          try {
            structured = stripNulls(JSON.parse(lastMessage));
          } catch {
            // not JSON: the caller falls back to the plain text
          }
        }
        finish({ ok: true, text: lastMessage, structured });
      });
      child.stdin.end(`${opts.system}\n\n${opts.prompt}`);
    });
  } finally {
    await rm(dir, { recursive: true, force: true }); // our own temporary folder
  }
}
