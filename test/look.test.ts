// Look and layout logic. The drawing itself was checked by eye in a real browser (light, dark, phone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore - plain browser JS modules
import { sectionsOf, layoutOf, showOf, parseEmail } from '../public/renderer.js';
// @ts-ignore
import { COLORS, ICON_NAMES, ICONS, fallbackLook, lookFor } from '../public/look.js';
import { validateRecipe, RECIPE_SCHEMA } from '../src/recipe.ts';
import { goodRecipe } from './fixture.ts';

const screen = (fields: any[], actions: any[] = [{ id: 'go', label: 'Go' }], layout?: string) => ({ id: 's', title: 'S', layout, fields, actions });
const field = (id: string, section?: string) => ({ id, label: id, type: 'text', required: false, ...(section ? { section } : {}) });

test('fields are grouped into sections, and a field without a heading joins the one before it', () => {
  const s = screen([field('a', 'You'), field('b'), field('c', 'Items'), field('d', 'Items'), field('e', 'Pay')]);
  assert.deepEqual(sectionsOf(s).map((x: any) => [x.title, x.fields.map((f: any) => f.id)]), [['You', ['a', 'b']], ['Items', ['c', 'd']], ['Pay', ['e']]]);
  assert.deepEqual(sectionsOf(screen([field('a'), field('b')])).map((x: any) => x.title), [null], 'no headings at all: one plain group');
  assert.deepEqual(sectionsOf(screen([field('a'), field('b', 'X')])).map((x: any) => x.title), [null, 'X']);
  assert.deepEqual(sectionsOf(screen([])), []);
});

test('a layout the screen cannot support falls back to a plain form', () => {
  const two = [field('a', 'One'), field('b', 'Two')];
  assert.equal(layoutOf(screen(two, undefined, 'steps')), 'steps');
  assert.equal(layoutOf(screen([field('a', 'One'), field('b', 'One')], undefined, 'steps')), 'form', 'steps needs two sections');
  assert.equal(layoutOf(screen([field('a')], undefined, 'steps')), 'form');
  const list = { id: 'l', label: 'L', kind: 'list', uses: 'x' };
  assert.equal(layoutOf(screen([], [list], 'data')), 'data');
  assert.equal(layoutOf(screen([], [{ id: 'g', label: 'G' }], 'data')), 'form', 'data needs a list button');
  assert.equal(layoutOf(screen(two, undefined, 'split')), 'split');
  for (const bad of [undefined, '', 'grid', 'SPLIT', 7, null]) assert.equal(layoutOf(screen(two, undefined, bad as any)), 'form', String(bad));
});

test('result styles are limited to the menu', () => {
  assert.equal(showOf({ show: 'email' }), 'email');
  assert.equal(showOf({ show: 'document' }), 'document');
  for (const bad of [undefined, 'html', 'EMAIL', '', 5]) assert.equal(showOf({ show: bad }), 'plain', String(bad));
  assert.equal(showOf(undefined), 'plain');
});

test('an email is split into header lines and message, with any short preface kept apart', () => {
  const full = parseEmail("Here's your email.\n\nTo: rosa@example.com\nSubject: Thank you!\n\nHi Rosa,\n\nThanks.\n\nBest,\nMe");
  assert.deepEqual(full.headers, [['To', 'rosa@example.com'], ['Subject', 'Thank you!']]);
  assert.equal(full.preface, "Here's your email.");
  assert.equal(full.body, 'Hi Rosa,\n\nThanks.\n\nBest,\nMe');
  assert.ok(full.email.startsWith('To: rosa@example.com') && !full.email.includes('Here'), 'copying leaves the preface out');
  const plain = parseEmail('Hi Rosa,\n\nNo header lines here.');
  assert.deepEqual([plain.headers, plain.preface, plain.body], [[], '', 'Hi Rosa,\n\nNo header lines here.']);
  assert.deepEqual(parseEmail('SUBJECT: Loud\r\nto: a@b.c\r\n\r\nBody').headers, [['Subject', 'Loud'], ['To', 'a@b.c']]);
  const late = 'one\ntwo\nthree\nfour\nfive\nsix\nTo: far@example.com\n\nBody';
  assert.deepEqual(parseEmail(late).headers, [], 'a "To:" line buried deep in the text is not a header');
  assert.deepEqual(parseEmail('Subject:\n\nBody').headers, [], 'empty header values are ignored');
  assert.deepEqual(parseEmail('').headers, []);
});

test('the menu of looks is fixed: 8 colors, 17 icons, every icon has shapes', () => {
  assert.equal(COLORS.length, 8);
  assert.equal(new Set(COLORS).size, 8);
  assert.equal(ICON_NAMES.length, 17);
  for (const name of ICON_NAMES) assert.ok(ICONS[name].length > 0 && ICONS[name].every(([tag, attrs]: any) => ['path', 'circle', 'rect', 'polygon'].includes(tag) && typeof attrs === 'object'), name);
});

test('a helper always gets a valid, steady look', () => {
  assert.deepEqual(fallbackLook('Invoicing'), fallbackLook('invoicing'), 'same name, same look (any capitals)');
  const spread = new Set(['invoicing', 'inventory', 'customer-follow-up', 'seo audit', 'pricing', 'brand voice', 'emails', 'reports'].map((n) => fallbackLook(n).color));
  assert.ok(spread.size >= 4, 'different helpers get different colors: ' + [...spread]);
  assert.deepEqual(lookFor('x', { color: 'rose', icon: 'users' }), { color: 'rose', icon: 'users' });
  const fb = fallbackLook('x');
  assert.deepEqual(lookFor('x', { color: 'hotpink', icon: 'rocket' }), fb, 'anything off the menu is ignored');
  assert.deepEqual(lookFor('x', { color: 'rose', icon: 'rocket' }), { color: 'rose', icon: fb.icon }, 'each part is checked on its own');
  for (const none of [undefined, null, {}, 'teal', 5]) assert.deepEqual(lookFor('x', none), fb);
});

test('recipes may carry looks, and bad ones are caught with plain reasons', () => {
  const base = () => {
    const r: any = goodRecipe();
    r.look = { color: 'green', icon: 'receipt' };
    const s = r.screens[0];
    s.layout = 'split';
    s.fields[0].section = 'Customer';
    s.fields[0].width = 'half';
    s.actions[0].show = 'document';
    return r;
  };
  assert.deepEqual(validateRecipe(base()), []);
  const bad = (mutate: (r: any) => void, expected: RegExp) => {
    const r = base();
    mutate(r);
    assert.ok(validateRecipe(r).some((e) => expected.test(e)), `${expected}: ${JSON.stringify(validateRecipe(r))}`);
  };
  bad((r) => (r.look.color = 'hotpink'), /look\.color must be one of: teal/);
  bad((r) => (r.look.icon = 'rocket'), /look\.icon must be one of/);
  bad((r) => delete r.look.icon, /look\.icon is missing/);
  bad((r) => (r.screens[0].layout = 'grid'), /layout must be one of: form, split, data, steps/);
  bad((r) => (r.screens[0].fields[0].width = 'third'), /width must be one of: half, full/);
  bad((r) => (r.screens[0].actions[0].show = 'html'), /show must be one of: plain, document, email/);
  bad((r) => (r.screens[0].layout = 'data'), /"data" layout, so it needs a "list" action/);
  bad((r) => (r.screens[0].layout = 'steps'), /"steps" layout, so its fields need at least two different sections/);
  const ok = base();
  ok.screens[0].layout = 'steps';
  ok.screens[0].fields[1].section = 'Items';
  assert.deepEqual(validateRecipe(ok), [], 'steps with two sections is fine');
  const old: any = goodRecipe();
  assert.deepEqual(validateRecipe(old), [], 'recipes saved before looks existed still pass');
});

test('the look fields are optional in the schema, so older screens stay valid', () => {
  const s: any = RECIPE_SCHEMA;
  assert.ok(!s.required.includes('look'));
  assert.ok(!s.properties.screens.items.required.includes('layout'));
  assert.ok(!s.properties.screens.items.properties.fields.items.required.some((k: string) => ['section', 'width'].includes(k)));
  assert.ok(!s.properties.screens.items.properties.actions.items.required.includes('show'));
});
