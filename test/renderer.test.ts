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

test('only AI actions ask "are you sure"; saving and listing never do', async () => {
  // @ts-ignore - plain browser JS module
  const { needsConfirm } = await import('../public/renderer.js');
  assert.equal(needsConfirm({ kind: 'save', writesFiles: true, sendsMessages: true }), false);
  assert.equal(needsConfirm({ kind: 'list', writesFiles: true }), false);
  assert.equal(needsConfirm({ writesFiles: true }), true, 'no kind means an AI action');
  assert.equal(needsConfirm({ kind: 'run', sendsMessages: true }), true);
  assert.equal(needsConfirm({ kind: 'run', writesFiles: false, sendsMessages: false }), false);
});

test('spreadsheet downloads cannot smuggle in formulas', async () => {
  // @ts-ignore - plain browser JS module
  const { toCsv } = await import('../public/renderer.js');
  const csv = toCsv([{ id: 'a', label: 'Name' }, { id: 'b', label: 'Note' }], [{ a: '=HYPERLINK("http://evil")', b: 'He said "hi"' }, { a: '-5', b: 'ok' }]);
  assert.equal(csv, '"Name","Note"\r\n"\'=HYPERLINK(""http://evil"")","He said ""hi"""\r\n"\'-5","ok"');
});

test('only small text files are accepted', () => {
  assert.equal(fileProblem('prices.csv', 100), null);
  assert.match(fileProblem('photo.png', 100), /text files only/);
  assert.match(fileProblem('big.txt', MAX_FILE_BYTES + 1), /too big/);
});

test('AI text is split into simple blocks; HTML stays plain text', async () => {
  // @ts-ignore - plain browser JS module
  const { parseMarkdown, parseInline } = await import('../public/renderer.js');
  const md = '# Title\n\nShort **version** here.\nSecond line.\n\n- one\n- two\n1. first\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---\n<script>alert(1)</script>';
  assert.deepEqual(parseMarkdown(md), [
    { type: 'h', text: 'Title' },
    { type: 'p', text: 'Short **version** here.\nSecond line.' },
    { type: 'list', ordered: false, items: ['one', 'two'] },
    { type: 'list', ordered: true, items: ['first'] },
    { type: 'table', rows: [['A', 'B'], ['1', '2']] },
    { type: 'p', text: '<script>alert(1)</script>' },
  ]);
  assert.deepEqual(parseInline('a **b** `c` d'), [{ t: 'a ' }, { b: 'b' }, { t: ' ' }, { code: 'c' }, { t: ' d' }]);
  assert.deepEqual(parseInline('5 * 3 = 15'), [{ t: '5 * 3 = 15' }]);
});
