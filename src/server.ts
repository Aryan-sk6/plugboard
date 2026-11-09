// Local web server. Listens on 127.0.0.1 only, so nothing outside this computer can reach it.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname, normalize, sep } from 'node:path';
import { listPlugins, readInstructions } from './reader.ts';
import { getRecipe, type GeneratorDeps } from './generator.ts';
import { getStatus, startInstall, startSignin, sendSigninCode } from './setup.ts';
import { runAction, type Adapter, type RunResult } from './runner.ts';
import { PROVIDERS, isProviderId, type ProviderId } from './providers.ts';
import { readProvider, writeProvider } from './settings.ts';
import { Store, recordLabel } from './store.ts';
import { defaultDataDir } from './paths.ts';
import { resolvePicks, toRecord, recordsTable, recordsForPrompt } from './records.ts';
// @ts-ignore - plain JS shared with the browser, so the page and the server check answers the same way
import { validateValues } from '../public/renderer.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
/** Where data lived before it moved to Documents/Plugboard (copied over once by the CLI). */
export const OLD_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../examples/', import.meta.url));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export interface Options {
  /** Claude config folder to read. Defaults to the user's real one. */
  claudeHome?: string;
  /** Plugboard's own data folder (recipe cache, later the database). */
  dataDir?: string;
  /** Replaces the AI call; tests only. */
  ask?: GeneratorDeps['ask'];
  /** Replaces the AI program used for runs; tests only. */
  adapter?: Adapter;
  /** Folder of sample plugins; defaults to Plugboard's own examples. "" turns them off. */
  examplesDir?: string;
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function json(res: ServerResponse, status: number, data: unknown) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
}

// Blocks other websites from reaching us through a fake domain that points at 127.0.0.1 (DNS rebinding).
function hostOk(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

// Actions must come from Plugboard's own page: JSON body (other sites' plain forms can't send it) and a matching Origin.
function sameSite(req: IncomingMessage): boolean {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return false;
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${req.headers.host}`;
}

async function readBody(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error('request body too large');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const GONE = "This helper isn't on this computer any more. Go back and pick another one.";
const COLLECTION = /^[a-z][a-z0-9_]{0,39}$/;

const stores = new Map<string, Store>();
function storeFor(opts: Options): Store {
  const dir = dataDir(opts);
  let s = stores.get(dir);
  if (!s) stores.set(dir, (s = new Store(join(dir, 'plugboard.db'))));
  return s;
}

function dataDir(opts: Options): string {
  return opts.dataDir ?? defaultDataDir();
}

/** Which AI the user chose (Claude unless they picked ChatGPT on the Connect screen). */
function currentProvider(opts: Options): ProviderId {
  return readProvider(dataDir(opts));
}

function adapterFor(opts: Options): Adapter {
  return opts.adapter ?? PROVIDERS[currentProvider(opts)].adapter;
}

/** The AI call used to design screens: the test stand-in if given, otherwise the chosen AI. */
function askFor(opts: Options): GeneratorDeps['ask'] {
  return opts.ask ?? ((o) => adapterFor(opts).ask(o));
}

/** Setup status for one AI (the requested one, or the current one), plus what the screen needs to describe it. */
async function statusFor(opts: Options, requested: unknown) {
  const id = isProviderId(requested) ? requested : currentProvider(opts);
  const p = PROVIDERS[id];
  return {
    ...(await getStatus(id)),
    provider: { id, label: p.label, plan: p.plan, notice: p.notice ?? null, canInstall: Boolean(p.installCommand), installHelp: p.installHelp },
    current: currentProvider(opts),
    choices: Object.values(PROVIDERS).map((x) => ({ id: x.id, label: x.label })),
  };
}

/** The user's helpers plus Plugboard's examples ("" turns examples off, for tests). */
function helpers(opts: Options) {
  return listPlugins(opts.claudeHome, opts.examplesDir === '' ? undefined : (opts.examplesDir ?? EXAMPLES));
}

async function findHelper(opts: Options, id: unknown) {
  return (await helpers(opts)).find((i) => i.id === id);
}

/** What to keep from an AI answer when an action saves it. */
function resultForRecord(r: RunResult): unknown {
  if (r.kind === 'text') return r.text.slice(0, 20_000);
  if (r.kind === 'file') return `${r.name}\n\n${r.text.slice(0, 20_000)}`;
  if (r.kind === 'table') return r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c.label, row[c.id]])));
  return undefined;
}

/** Runs one button press and streams progress as one JSON object per line. */
async function run(req: IncomingMessage, res: ServerResponse, body: any, opts: Options) {
  const item = await findHelper(opts, body?.id);
  if (!item) return json(res, 404, { error: GONE });
  const { recipe } = await getRecipe(item, { dataDir: dataDir(opts), ask: askFor(opts) });
  const screen = recipe.screens.find((s) => s.id === body.screenId);
  const action = screen?.actions.find((a) => a.id === body.actionId);
  if (!screen || !action) return json(res, 409, { error: 'This screen has changed. Please refresh the page and try again.' });
  const raw = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values : {};
  const kind = action.kind ?? 'run';
  // Same checks as the page, repeated here because the page can't be trusted on its own.
  const problems = kind === 'list' ? {} : validateValues(screen, raw);
  if (Object.keys(problems).length) return json(res, 400, { error: 'Some answers need fixing. Please check the form and try again.' });

  const store = storeFor(opts);
  const values = resolvePicks(screen, raw, store, item.id);

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  const line = (o: unknown) => res.writableEnded || res.write(JSON.stringify(o) + '\n');
  line({ type: 'started' });

  let result: RunResult & { savedNote?: string };
  if (kind === 'list') {
    result = recordsTable(action.uses!, store.list(item.id, action.uses!));
  } else if (kind === 'save') {
    const data = toRecord(screen, values);
    const keyLabel = screen.fields.find((f) => f.id === action.keyField)?.label;
    if (!Object.keys(data).length) result = { kind: 'error', text: 'There is nothing to save yet. Fill in the form first.' };
    else {
      const { updated } = store.save(item.id, action.saveTo!, data, keyLabel);
      result = { kind: 'saved', text: updated ? `Updated the existing record in your ${action.saveTo}.` : `Saved to your ${action.saveTo}.` };
    }
  } else {
    const stop = new AbortController();
    res.on('close', () => stop.abort()); // page closed or Stop pressed: stop the AI too
    const saved = action.uses ? recordsForPrompt(action.uses, store.list(item.id, action.uses)) : undefined;
    result = await runAction(
      { item, instructions: await readInstructions(item), screen, action, values, saved },
      { adapter: adapterFor(opts), signal: stop.signal, onProgress: (p) => line({ ...p, kind: p.type, type: 'progress' }) },
    );
    const keep = resultForRecord(result);
    if (action.saveTo && keep !== undefined) {
      store.save(item.id, action.saveTo, { ...toRecord(screen, values), Result: keep });
      result.savedNote = `Saved to your ${action.saveTo}.`;
    }
  }
  line({ type: 'result', result });
  res.end();
}

export function createApp(opts: Options = {}) {
  return createServer(async (req, res) => {
    try {
      if (!hostOk(req)) return send(res, 403, 'text/plain', 'Forbidden');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'POST') {
        if (!sameSite(req)) return json(res, 403, { error: 'Not allowed.' });
        const body = await readBody(req);
        const which = isProviderId(body?.provider) ? body.provider : currentProvider(opts);
        if (url.pathname === '/api/setup/install') {
          startInstall(undefined, which);
          return json(res, 200, await statusFor(opts, which));
        }
        if (url.pathname === '/api/setup/signin') {
          await startSignin(which);
          return json(res, 200, await statusFor(opts, which));
        }
        if (url.pathname === '/api/settings') {
          if (!isProviderId(body?.provider)) return json(res, 400, { error: 'Please pick Claude or ChatGPT.' });
          writeProvider(dataDir(opts), body.provider);
          return json(res, 200, await statusFor(opts, body.provider));
        }
        if (url.pathname === '/api/run') return run(req, res, body, opts);
        if (url.pathname === '/api/records/delete') {
          const item = await findHelper(opts, body?.id);
          if (!item) return json(res, 404, { error: GONE });
          if (!COLLECTION.test(String(body.collection)) || !Number.isInteger(body.recordId)) return json(res, 400, { error: 'Not allowed.' });
          const ok = storeFor(opts).remove(item.id, body.collection, body.recordId);
          return ok ? json(res, 200, { ok: true }) : json(res, 404, { error: 'That record was already deleted.' });
        }
        if (url.pathname === '/api/setup/code') {
          if (!sendSigninCode(String(body?.code ?? ''), which)) return json(res, 400, { error: "That code didn't work. Copy it again from the sign-in page and paste it here." });
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: 'Not found.' });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Not allowed.' });

      if (url.pathname === '/api/setup/status') return json(res, 200, await statusFor(opts, url.searchParams.get('provider')));

      if (url.pathname === '/api/info') return json(res, 200, { dataDir: dataDir(opts), provider: PROVIDERS[currentProvider(opts)].label });

      if (url.pathname === '/api/plugins') return json(res, 200, { items: await helpers(opts) });

      if (url.pathname === '/api/records') {
        const item = await findHelper(opts, url.searchParams.get('id'));
        if (!item) return json(res, 404, { error: GONE });
        const collection = String(url.searchParams.get('collection'));
        if (!COLLECTION.test(collection)) return json(res, 400, { error: 'Not allowed.' });
        return json(res, 200, { records: storeFor(opts).list(item.id, collection).map((r) => ({ id: r.id, label: recordLabel(r.data) })) });
      }

      if (url.pathname === '/api/recipe') {
        const item = (await helpers(opts)).find((i) => i.id === url.searchParams.get('id'));
        if (!item) return json(res, 404, { error: "This helper isn't on this computer any more. Go back and pick another one." });
        return json(res, 200, { item, ...(await getRecipe(item, { dataDir: dataDir(opts), ask: askFor(opts) })) });
      }

      const rel = decodeURIComponent(url.pathname.slice(1)) + (url.pathname.endsWith('/') ? 'index.html' : '');
      const file = normalize(join(PUBLIC, rel));
      if (!file.startsWith(PUBLIC.endsWith(sep) ? PUBLIC : PUBLIC + sep)) return send(res, 404, 'text/plain', 'Not found');
      try {
        return send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', await readFile(file));
      } catch {
        return send(res, 404, 'text/plain', 'Not found');
      }
    } catch (err) {
      console.error(err); // details stay in the terminal; the browser gets a plain message
      json(res, 500, { error: 'Something went wrong on this computer. Try again, or restart Plugboard.' });
    }
  });
}
