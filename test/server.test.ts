import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeClaudeHome, goodRecipe } from './fixture.ts';

// AI calls replaced with fixed answers; this only checks the HTTP wiring.
const server = createApp({
  claudeHome: await makeClaudeHome(),
  dataDir: await mkdtemp(join(tmpdir(), 'plugboard-data-')),
  ask: async () => ({ ok: true, text: '', structured: goodRecipe() }),
  adapter: {
    id: 'claude',
    label: 'test',
    ask: async (o) => {
      o.onProgress?.({ type: 'text', text: 'Invoice ' });
      return { ok: true, text: 'Invoice for ' + (/Customer name: (\w+)/.exec(o.prompt)?.[1] ?? '?') };
    },
  },
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as AddressInfo).port;
after(() => server.close());

function get(path: string, host = `127.0.0.1:${port}`, method = 'GET', extra: Record<string, string> = {}): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host, ...extra } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, type: String(res.headers['content-type']), body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the plugin list as JSON', async () => {
  const r = await get('/api/plugins');
  assert.equal(r.status, 200);
  assert.match(r.type, /application\/json/);
  assert.equal(JSON.parse(r.body).items.length, 5);
});

test('serves the list screen', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.body, /<title>Plugboard<\/title>/);
  assert.equal((await get('/app.js')).status, 200);
  assert.match((await get('/dev/')).body, /Component test page/);
});

test('refuses requests that come through another hostname', async () => {
  assert.equal((await get('/api/plugins', 'evil.example:80')).status, 403);
  assert.equal((await get('/api/plugins', `localhost:${port}`)).status, 200);
});

test('does not serve files outside the public folder', async () => {
  assert.equal((await get('/../package.json')).status, 404);
  assert.equal((await get('/..%2Fpackage.json')).status, 404);
  assert.equal((await get('/%2e%2e%2fsrc%2fserver.ts')).status, 404);
});

test('actions only accept JSON from Plugboard itself', async () => {
  const host = `127.0.0.1:${port}`;
  assert.equal((await get('/api/setup/install', host, 'POST')).status, 403, 'plain form post from another site');
  assert.equal((await get('/api/setup/install', host, 'POST', { 'content-type': 'text/plain' })).status, 403);
  assert.equal((await get('/api/setup/install', host, 'POST', { 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403);
  assert.equal((await get('/api/nope', host, 'POST', { 'content-type': 'application/json', origin: `http://${host}` })).status, 404);
  assert.equal((await get('/api/plugins', host, 'DELETE')).status, 405);
});

test('recipe endpoint returns a recipe for a known helper and a plain 404 otherwise', async () => {
  const items = JSON.parse((await get('/api/plugins')).body).items;
  const r = await get('/api/recipe?id=' + encodeURIComponent(items[0].id));
  assert.equal(r.status, 200);
  const data = JSON.parse(r.body);
  assert.equal(data.source, 'generated');
  assert.equal(data.recipe.title, 'Invoice maker');
  const missing = await get('/api/recipe?id=nope');
  assert.equal(missing.status, 404);
  assert.match(JSON.parse(missing.body).error, /isn't on this computer/);
});

function post(path: string, body: object): Promise<{ status: number; body: string }> {
  const host = `127.0.0.1:${port}`;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host, 'content-type': 'application/json', origin: `http://${host}` } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode!, body: b }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('run endpoint streams progress then a result, and rejects unknown buttons', async () => {
  const items = JSON.parse((await get('/api/plugins')).body).items;
  const id = items.find((i: any) => i.name === 'invoice-maker').id;
  const ok = await post('/api/run', { id, screenId: 'main', actionId: 'make', values: { customer: 'Rosa' } });
  assert.equal(ok.status, 200);
  const lines = ok.body.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.type), ['started', 'progress', 'result']);
  assert.deepEqual(lines[2].result, { kind: 'text', text: 'Invoice for Rosa' });
  assert.equal((await post('/api/run', { id, screenId: 'main', actionId: 'nope', values: {} })).status, 409);
  assert.equal((await post('/api/run', { id: 'nope', screenId: 'main', actionId: 'make' })).status, 404);
});
