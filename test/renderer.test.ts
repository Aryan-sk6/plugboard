// Form-checking logic from the browser renderer. The DOM parts are checked by clicking through in a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore - plain browser JS module
import { validateValues, toNumber, cleanRows, fileProblem, MAX_FILE_BYTES } from '../public/renderer.js';
import { goodRecipe } from './fixture.ts';

const screen = goodRecipe().screens[0];
screen.fields.push({ id: 'ok', label: 'I agree', type: 'checkbox', required: true }, { id: 'list', label: 'File', type: 'file', required: true });

const filled = () => ({
  customer: 'Rosa',
  due: '2026-12-01',
  currency: 'EUR',
  lines: [{ item: 'Chair', price: 40 }],
  ok: true,
  list: { name: 'a.csv', size: 3, text: 'a,b' },
});

test('a fully filled form has no problems', () => {
  assert.deepEqual(validateValues(screen, filled()), {});
});

test('required fields, wrong numbers, dates and choices are caught with plain messages', () => {
  const v = { ...filled(), customer: '   ', due: 'tomorrow', currency: 'GBP', lines: [{ item: 'Chair', price: NaN }], ok: false, list: null };
  assert.deepEqual(validateValues(screen, v), {
    customer: 'Please fill this in.',
    due: 'Please pick a date.',
    currency: 'Please pick one of the choices.',
    lines: "Row 1 has something that isn't a number in a number column.",
    ok: 'Please tick this box.',
    list: 'Please choose a file.',
  });
  assert.equal(validateValues(screen, { ...filled(), lines: [] }).lines, 'Please fill in at least one row.');
  assert.equal(validateValues(screen, { ...filled(), currency: '' }).currency, 'Please pick one of the choices.');
});

test('optional empty fields are fine', () => {
  assert.equal(validateValues(screen, { ...filled(), due: '' }).due, undefined);
});

test('numbers accept thousands separators and reject words', () => {
  assert.equal(toNumber('1,200.5'), 1200.5);
  assert.equal(toNumber('  '), '');
  assert.ok(Number.isNaN(toNumber('twelve')));
  const numberScreen = { fields: [{ id: 'n', label: 'N', type: 'number', required: true }] };
  assert.deepEqual(validateValues(numberScreen, { n: toNumber('abc') }), { n: 'Please enter a number, like 12 or 4.5.' });
  assert.deepEqual(validateValues(numberScreen, { n: 0 }), {}, 'zero is a valid number');
});

test('empty table rows are dropped', () => {
  assert.deepEqual(cleanRows([{ a: '', b: '' }, { a: 'x', b: '' }, { a: ' ', b: '' }]), [{ a: 'x', b: '' }]);
});

test('only small text files are accepted', () => {
  assert.equal(fileProblem('prices.csv', 100), null);
  assert.match(fileProblem('photo.png', 100), /text files only/);
  assert.match(fileProblem('big.txt', MAX_FILE_BYTES + 1), /too big/);
});
