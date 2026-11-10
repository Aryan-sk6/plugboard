import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, recordLabel } from '../src/store.ts';

test('save, list (newest first), get and delete', () => {
  const s = new Store(':memory:');
  const a = s.save('p1', 'customers', { 'Customer name': 'Rosa' });
  const b = s.save('p1', 'customers', { 'Customer name': 'Ben' });
  assert.deepEqual(s.list('p1', 'customers').map((r) => r.data['Customer name']), ['Ben', 'Rosa']);
  assert.equal(s.get('p1', 'customers', a.id)?.data['Customer name'], 'Rosa');
  assert.equal(s.remove('p1', 'customers', b.id), true);
  assert.equal(s.remove('p1', 'customers', b.id), false);
  assert.equal(s.list('p1', 'customers').length, 1);
});

test('each helper only sees its own records', () => {
  const s = new Store(':memory:');
  const { id } = s.save('helper-a', 'customers', { name: 'Secret' });
  assert.deepEqual(s.list('helper-b', 'customers'), []);
  assert.equal(s.get('helper-b', 'customers', id), null);
  assert.equal(s.remove('helper-b', 'customers', id), false, "cannot delete another helper's record");
  assert.equal(s.get('helper-a', 'other_list', id), null, 'lists are separate too');
});

test('saving the same key again updates instead of duplicating', () => {
  const s = new Store(':memory:');
  s.save('p', 'stock', { Item: 'Blue mug', Count: 4, Shelf: 'A' }, 'Item');
  const again = s.save('p', 'stock', { Item: ' blue MUG ', Count: 9 }, 'Item');
  assert.equal(again.updated, true);
  const all = s.list('p', 'stock');
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].data, { Item: 'Blue mug', Count: 9, Shelf: 'A' }, 'keeps the original spelling of the key');
});

test('records survive closing and reopening the file', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'maginary-db-')), 'data', 'plugboard.db');
  const s1 = new Store(file);
  s1.save('p', 'invoices', { Number: 'INV-1' });
  s1.close();
  const s2 = new Store(file);
  assert.equal(s2.list('p', 'invoices')[0].data.Number, 'INV-1');
  s2.close();
});

test('very large records are refused', () => {
  assert.throws(() => new Store(':memory:').save('p', 'x', { big: 'x'.repeat(300_000) }), /too big/);
});

test('record labels prefer name-like fields', () => {
  assert.equal(recordLabel({ Email: 'a@b.c', 'Customer name': 'Rosa' }), 'Rosa');
  assert.equal(recordLabel({ Count: 3, Notes: 'Blue mug' }), 'Blue mug');
  assert.equal(recordLabel({ Count: 3 }), 'Saved record');
});
