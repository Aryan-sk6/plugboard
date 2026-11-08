import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.ts';
import { makeClaudeHome } from './fixture.ts';

const server = createApp({ claudeHome: await makeClaudeHome() });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as AddressInfo).port;
after(() => server.close());

function get(path: string, host = `127.0.0.1:${port}`, method = 'GET'): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host } }, (res) => {
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

test('rejects non-GET requests for now', async () => {
  assert.equal((await get('/api/plugins', undefined, 'POST')).status, 405);
});
