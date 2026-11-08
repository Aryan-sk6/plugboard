import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { toRecord, resolvePicks, recordsTable, recordsForPrompt } from '../src/records.ts';
import { validateRecipe } from '../src/recipe.ts';
import { goodRecipe, storeScreens } from './fixture.ts';

test('answers are stored under their labels, only for known fields', () => {
  const screen = goodRecipe().screens[0];
  screen.fields.push({ id: 'ok', label: 'Paid?', type: 'checkbox', required: false }, { id: 'f', label: 'Attachment', type: 'file', required: false });
  const data = toRecord(screen, { customer: 'Rosa', due: '', currency: 'EUR', lines: [{ item: 'Chair', price: 40 }], ok: true, f: { name: 'a.csv', text: 'big' }, extra: 'dropped' });
  assert.deepEqual(data, { 'Customer name': 'Rosa', Currency: 'EUR', Items: [{ Item: 'Chair', Price: 40 }], 'Paid?': 'Yes', Attachment: 'a.csv' });
});

test('picked records are looked up only in the same helper', () => {
  const s = new Store(':memory:');
  const mine = s.save('me', 'customers', { 'Customer name': 'Rosa', Email: 'r@x.com' });
  const theirs = s.save('other', 'customers', { 'Customer name': 'Hidden' });
  const screen = storeScreens()[1];
  assert.deepEqual(resolvePicks(screen, { who: String(mine.id), topic: 'Hi' }, s, 'me').who, { picked: 'Rosa', data: { 'Customer name': 'Rosa', Email: 'r@x.com' } });
  assert.equal(resolvePicks(screen, { who: String(theirs.id) }, s, 'me').who, '');
  assert.equal(resolvePicks(screen, { who: 'abc' }, s, 'me').who, '');
});

test('saved records become a table with ids, and text for the AI', () => {
  const s = new Store(':memory:');
  s.save('p', 'stock', { Item: 'Mug', Count: 4 });
  s.save('p', 'stock', { Item: 'Plate', Sizes: [1, 2] });
  const t = recordsTable('stock', s.list('p', 'stock'));
  assert.deepEqual(t.columns.map((c) => c.label), ['Item', 'Sizes', 'Count', 'Saved']);
  assert.equal(t.rows[0].c0, 'Plate');
  assert.equal(t.rows[0].c1, '2 items');
  assert.match(t.rows[1]._id, /^\d+$/);
  assert.match(recordsForPrompt('stock', s.list('p', 'stock')), /Saved stock \(2, newest first.*\n\{"Item":"Plate"/);
});

test('recipes with save, list and pick-a-record are valid; broken ones are caught', () => {
  const r = { ...goodRecipe(), screens: [...goodRecipe().screens, ...storeScreens()] };
  assert.deepEqual(validateRecipe(r), []);
  const bad = structuredClone(r);
  delete bad.screens[1].actions[0].saveTo;
  delete bad.screens[1].actions[1].uses;
  bad.screens[1].actions[0].keyField = 'nope';
  delete bad.screens[2].fields[0].collection;
  const errors = validateRecipe(bad).join('\n');
  assert.match(errors, /saves records, so it needs saveTo/);
  assert.match(errors, /lists records, so it needs uses/);
  assert.match(errors, /keyField "nope" is not a field/);
  assert.match(errors, /picks a saved record, so it needs a collection/);
});
