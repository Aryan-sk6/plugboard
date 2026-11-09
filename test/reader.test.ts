import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPlugins, parseFrontmatter } from '../src/reader.ts';
import { makeClaudeHome } from './fixture.ts';

test('parseFrontmatter handles plain, quoted, folded, CRLF, BOM and missing headers', () => {
  assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: b c\n---\nbody').data, { name: 'a', description: 'b c' });
  assert.equal(parseFrontmatter('﻿---\r\nname: "x \\"y\\""\r\n---\r\n').data.name, 'x "y"');
  assert.equal(parseFrontmatter("---\nname: 'it''s'\n---\n").data.name, "it's");
  assert.equal(parseFrontmatter('---\ndescription: >\n  one\n  two\n---\n').data.description, 'one two');
  assert.equal(parseFrontmatter('---\ndescription: |\n  one\n  two\n---\n').data.description, 'one\ntwo');
  assert.equal(parseFrontmatter('---\nmetadata:\n  version: 1\nname: z\n---\n').data.name, 'z');
  assert.deepEqual(parseFrontmatter('# just markdown').data, {});
});

test('listPlugins finds user skills, user commands and enabled plugin items', async () => {
  const home = await makeClaudeHome();
  const items = await listPlugins(home);
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.deepEqual(Object.keys(byName).sort(), ['count-stock', 'folded', 'follow-up', 'invoice-maker', 'reorder']);
  assert.equal(byName['invoice-maker'].source, 'Your skills');
  assert.equal(byName['invoice-maker'].kind, 'skill');
  assert.equal(byName['folded'].description, 'Line one line two.');
  assert.equal(byName['follow-up'].source, 'Your commands');
  assert.equal(byName['follow-up'].description, 'Write a friendly follow-up email to a customer.');
  assert.equal(byName['count-stock'].source, 'stock-tools');
  assert.equal(byName['count-stock'].description, 'Counts stock, "fast".');
  assert.equal(byName['reorder'].kind, 'command');
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'ids are unique');
});

test('listPlugins copes with a missing or broken config folder', async () => {
  assert.deepEqual(await listPlugins(join(tmpdir(), 'plugboard-nope-' + Date.now())), []);
  const home = await mkdtemp(join(tmpdir(), 'plugboard-broken-'));
  await mkdir(join(home, 'plugins'));
  await writeFile(join(home, 'plugins', 'installed_plugins.json'), '{ not json');
  await writeFile(join(home, 'settings.json'), 'also not json');
  assert.deepEqual(await listPlugins(home), []);
});

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const p = join(e.parentPath, e.name);
    const s = await stat(p);
    out[p] = e.isFile() ? `${createHash('sha256').update(await readFile(p)).digest('hex')}:${s.mtimeMs}` : `dir:${s.mtimeMs}`;
  }
  return out;
}

test('listPlugins never changes, adds or removes anything in the config folder', async () => {
  const home = await makeClaudeHome();
  const before = await snapshot(home);
  await listPlugins(home);
  await listPlugins(home);
  assert.deepEqual(await snapshot(home), before);
});

test('finds the 3 shipped business examples, listed first', async () => {
  const home = await makeClaudeHome();
  const items = await listPlugins(home, fileURLToPath(new URL('../examples/', import.meta.url)));
  const examples = items.filter((i) => i.id.startsWith('example:'));
  assert.deepEqual(examples.map((i) => [i.source, i.name]), [
    ['Examples', 'customer-follow-up'],
    ['Examples', 'inventory'],
    ['Examples', 'invoicing'],
  ]);
  assert.ok(examples.every((i) => i.description.length > 20), 'each example has a description');
  assert.equal(items.indexOf(examples[0]), 0);
});

test('reader source only uses read functions', async () => {
  const src = await readFile(new URL('../src/reader.ts', import.meta.url), 'utf8');
  for (const bad of ['writeFile', 'appendFile', 'mkdir', 'rm(', 'rmdir', 'unlink', 'rename', 'copyFile', 'chmod', 'createWriteStream', 'symlink', 'truncate']) {
    assert.ok(!src.includes(bad), `reader.ts must not use ${bad}`);
  }
});
