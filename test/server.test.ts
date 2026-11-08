import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeClaudeHome, goodRecipe, storeScreens } from './fixture.ts';

// AI calls replaced with fixed answers; this only checks the HTTP wiring.
const server = createApp({
  claudeHome: await makeClaudeHome(),
  examplesDir: '',
  dataDir: await mkdtemp(join(tmpdir(), 'plugboard-data-')),
  ask: async () => ({ ok: true, text: '', structured: { ...goodRecipe(), screens: [...goodRecipe().screens, ...storeScreens()] } }),
  adapter: {
    id: 'claude',
    label: 'test',
    ask: async (o) => {
      lastPrompt = o.prompt;
      o.onProgress?.({ type: 'text', text: 'Invoice ' });
      return { ok: true, text: 'Invoice for ' + (/Customer name: (\w+)/.exec(o.prompt)?.[1] ?? '?') };
    },
  },
});
let lastPrompt = '';
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
  const ok = await post('/api/run', { id, screenId: 'main', actionId: 'make', values: { customer: 'Rosa', currency: 'EUR', lines: [{ item: 'Chair', price: 40 }] } });
  assert.equal(ok.status, 200);
  const lines = ok.body.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.type), ['started', 'progress', 'result']);
  assert.deepEqual(lines[2].result, { kind: 'text', text: 'Invoice for Rosa' });
  assert.equal((await post('/api/run', { id, screenId: 'main', actionId: 'nope', values: {} })).status, 409);
  assert.equal((await post('/api/run', { id: 'nope', screenId: 'main', actionId: 'make' })).status, 404);
});

test('the server re-checks answers instead of trusting the page', async () => {
  const id = await helperId('invoice-maker');
  const r = await post('/api/run', { id, screenId: 'main', actionId: 'make', values: { customer: 'Rosa' } });
  assert.equal(r.status, 400);
  assert.match(JSON.parse(r.body).error, /need fixing/);
});

async function helperId(name: string): Promise<string> {
  return JSON.parse((await get('/api/plugins')).body).items.find((i: any) => i.name === name).id;
}
const lastResult = (body: string) => JSON.parse(body.trim().split('\n').at(-1)!).result;

test('save, list, pick a saved record for the AI, then delete', async () => {
  const id = await helperId('invoice-maker');
  const save = (name: string, email: string) => post('/api/run', { id, screenId: 'add', actionId: 'save', values: { name, email } });
  assert.deepEqual(lastResult((await save('Rosa', 'rosa@example.com')).body), { kind: 'saved', text: 'Saved to your customers.' });
  await save('Ben', '');
  assert.deepEqual(lastResult((await save('rosa', 'new@example.com')).body), { kind: 'saved', text: 'Updated the existing record in your customers.' });

  const list = lastResult((await post('/api/run', { id, screenId: 'add', actionId: 'show', values: {} })).body);
  assert.equal(list.kind, 'records');
  assert.deepEqual(list.rows.map((r: any) => r.c0), ['Ben', 'Rosa']);

  const picks = JSON.parse((await get(`/api/records?id=${encodeURIComponent(id)}&collection=customers`)).body).records;
  const rosa = picks.find((p: any) => p.label === 'Rosa');
  const draft = lastResult((await post('/api/run', { id, screenId: 'write', actionId: 'draft', values: { who: String(rosa.id), topic: 'Spring sale' } })).body);
  assert.match(lastPrompt, /Which customer\?: Rosa\n {2}- Customer name: Rosa\n {2}- Email: new@example\.com/);
  assert.match(lastPrompt, /<saved_records>\nSaved customers \(2/);
  assert.equal(draft.savedNote, 'Saved to your emails.');

  const del = await post('/api/records/delete', { id, collection: 'customers', recordId: rosa.id });
  assert.equal(del.status, 200);
  assert.equal((await post('/api/records/delete', { id, collection: 'customers', recordId: rosa.id })).status, 404);
  assert.equal(JSON.parse((await get(`/api/records?id=${encodeURIComponent(id)}&collection=customers`)).body).records.length, 1);
});

test('records of one helper are invisible to another', async () => {
  const mine = await helperId('invoice-maker');
  const other = await helperId('count-stock');
  await post('/api/run', { id: mine, screenId: 'add', actionId: 'save', values: { name: 'Private Pat' } });
  const otherList = JSON.parse((await get(`/api/records?id=${encodeURIComponent(other)}&collection=customers`)).body).records;
  assert.ok(!otherList.some((r: any) => r.label === 'Private Pat'));
  assert.equal((await get(`/api/records?id=${encodeURIComponent(mine)}&collection=../../x`)).status, 400);
});
