// Local web server. Listens on 127.0.0.1 only, so nothing outside this computer can reach it.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname, normalize, sep } from 'node:path';
import { listPlugins } from './reader.ts';
import { getRecipe, type GeneratorDeps } from './generator.ts';
import { getStatus, startInstall, startSignin, sendSigninCode } from './setup.ts';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const DATA = fileURLToPath(new URL('../data/', import.meta.url));
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
    if (raw.length > 100_000) throw new Error('request body too large');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function createApp(opts: Options = {}) {
  return createServer(async (req, res) => {
    try {
      if (!hostOk(req)) return send(res, 403, 'text/plain', 'Forbidden');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'POST') {
        if (!sameSite(req)) return json(res, 403, { error: 'Not allowed.' });
        const body = await readBody(req);
        if (url.pathname === '/api/setup/install') {
          startInstall();
          return json(res, 200, await getStatus());
        }
        if (url.pathname === '/api/setup/signin') {
          await startSignin();
          return json(res, 200, await getStatus());
        }
        if (url.pathname === '/api/setup/code') {
          if (!sendSigninCode(String(body?.code ?? ''))) return json(res, 400, { error: "That code didn't work. Copy it again from the sign-in page and paste it here." });
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: 'Not found.' });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Not allowed.' });

      if (url.pathname === '/api/setup/status') return json(res, 200, await getStatus());

      if (url.pathname === '/api/plugins') return json(res, 200, { items: await listPlugins(opts.claudeHome) });

      if (url.pathname === '/api/recipe') {
        const item = (await listPlugins(opts.claudeHome)).find((i) => i.id === url.searchParams.get('id'));
        if (!item) return json(res, 404, { error: "This helper isn't on this computer any more. Go back and pick another one." });
        return json(res, 200, { item, ...(await getRecipe(item, { dataDir: opts.dataDir ?? DATA, ask: opts.ask })) });
      }

      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
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
