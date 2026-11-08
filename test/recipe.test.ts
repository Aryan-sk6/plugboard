import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecipe, schemaForModel, fallbackRecipe, RECIPE_SCHEMA } from '../src/recipe.ts';
import { goodRecipe } from './fixture.ts';


test('accepts a good recipe and the fallback', () => {
  assert.deepEqual(validateRecipe(goodRecipe()), []);
  assert.deepEqual(validateRecipe(fallbackRecipe('X', 'Y')), []);
  assert.deepEqual(validateRecipe(fallbackRecipe('', '')), []);
});

test('rejects bad recipes with readable reasons', () => {
  const cases: [(r: any) => void, RegExp][] = [
    [(r) => (r.version = 2), /version must be one of/],
    [(r) => delete r.title, /recipe.title is missing/],
    [(r) => (r.screens = []), /screens needs at least 1/],
    [(r) => (r.screens[0].fields[0].type = 'html'), /type must be one of/],
    [(r) => (r.screens[0].fields[0].id = 'Bad Id'), /must match/],
    [(r) => (r.screens[0].fields[0].onclick = 'alert(1)'), /onclick is not allowed/],
    [(r) => (r.extra = 1), /recipe.extra is not allowed/],
    [(r) => delete r.screens[0].fields[2].options, /dropdown, so it needs options/],
    [(r) => (r.screens[0].fields[3].columns = []), /table, so it needs columns/],
    [(r) => (r.screens[0].fields[1].id = 'customer'), /"customer" is used twice/],
    [(r) => (r.screens[0].actions[0].writesFiles = 'no'), /should be boolean/],
    [(r) => (r.title = 'x'.repeat(81)), /longer than 80/],
    [(r) => (r.screens[0].actions = []), /actions needs at least 1/],
  ];
  for (const [mutate, expected] of cases) {
    const r = goodRecipe();
    mutate(r);
    const errors = validateRecipe(r);
    assert.ok(errors.some((e) => expected.test(e)), `${expected}: got ${JSON.stringify(errors)}`);
  }
  assert.ok(validateRecipe(null).length);
  assert.ok(validateRecipe('text').length);
});

test('model schema drops only the limits, keeps the structure', () => {
  const s = schemaForModel();
  const json = JSON.stringify(s);
  assert.ok(!/maxLength|minLength|maxItems|pattern/.test(json));
  assert.equal(s.screens === undefined, true);
  assert.deepEqual(s.required, RECIPE_SCHEMA.required);
  assert.equal(s.properties.screens.minItems, 1);
  assert.equal(s.properties.screens.items.properties.fields.items.additionalProperties, false);
  assert.deepEqual(s.properties.screens.items.properties.fields.items.properties.type.enum, RECIPE_SCHEMA.properties.screens.items.properties.fields.items.properties.type.enum);
});
