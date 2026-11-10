import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, isAbsolute, dirname } from 'node:path';
import { documentsDir, defaultDataDir, legacyDataDir, copyOldData } from '../src/paths.ts';

test('finds a real Documents folder on this system', () => {
  const d = documentsDir();
  assert.ok(isAbsolute(d) && existsSync(d), d);
  assert.notEqual(d, '', 'never empty');
});

test('data lives in Documents/Maginary, unless MAGINARY_DATA says otherwise', () => {
  const old = process.env.MAGINARY_DATA;
  try {
    process.env.MAGINARY_DATA = join(tmpdir(), 'pb-custom');
    assert.equal(defaultDataDir(), join(tmpdir(), 'pb-custom'));
    delete process.env.MAGINARY_DATA;
    const d = defaultDataDir();
    assert.ok(d.endsWith(join('', 'Maginary')) && d.startsWith(homedir()), d);
  } finally {
    if (old === undefined) delete process.env.MAGINARY_DATA;
    else process.env.MAGINARY_DATA = old;
  }
});

test('old data is copied once and never overwrites newer data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pb-move-'));
  const oldDir = join(root, 'old');
  const newDir = join(root, 'new');
  assert.equal(copyOldData(oldDir, newDir), false, 'nothing to copy');
  await mkdir(join(oldDir, 'recipes'), { recursive: true });
  await writeFile(join(oldDir, 'plugboard.db'), 'OLD');
  await writeFile(join(oldDir, 'recipes', 'r.json'), '{}');
  assert.equal(copyOldData(oldDir, newDir), true);
  assert.equal(await readFile(join(newDir, 'plugboard.db'), 'utf8'), 'OLD');
  assert.ok(existsSync(join(newDir, 'recipes', 'r.json')));
  assert.ok(existsSync(join(oldDir, 'plugboard.db')), 'old copy left in place');
  await writeFile(join(newDir, 'plugboard.db'), 'NEW');
  assert.equal(copyOldData(oldDir, newDir), false, 'new folder already has data');
  assert.equal(await readFile(join(newDir, 'plugboard.db'), 'utf8'), 'NEW');
});

test('records from when the app was called Plugboard are found next to the new folder', () => {
  const old = process.env.MAGINARY_DATA;
  try {
    delete process.env.MAGINARY_DATA;
    assert.ok(legacyDataDir().endsWith('Plugboard'));
    assert.equal(dirname(legacyDataDir()), dirname(defaultDataDir()), 'same Documents folder');
    assert.ok(defaultDataDir().endsWith('Maginary'));
  } finally {
    if (old !== undefined) process.env.MAGINARY_DATA = old;
  }
});
