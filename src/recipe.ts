// Screen recipe: the JSON the AI returns to describe a plugin's screens.
// It is data only. The Renderer maps it onto a fixed set of components; nothing in it is ever executed.

export const FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'dropdown', 'checkbox', 'file', 'table'] as const;
export const OUTPUT_TYPES = ['text', 'table', 'file'] as const;

export interface Column { id: string; label: string; type: 'text' | 'number' | 'date' }
export interface Field {
  id: string;
  label: string;
  type: (typeof FIELD_TYPES)[number];
  required: boolean;
  help?: string;
  placeholder?: string;
  options?: string[];
  columns?: Column[];
}
export interface Action {
  id: string;
  label: string;
  /** Plain-language description of what pressing the button does. Shown to the user. */
  does: string;
  output: (typeof OUTPUT_TYPES)[number];
  writesFiles: boolean;
  sendsMessages: boolean;
}
export interface Screen { id: string; title: string; intro?: string; fields: Field[]; actions: Action[] }
export interface Recipe { version: 1; title: string; summary: string; screens: Screen[] }

const ID = { type: 'string', pattern: '^[a-z][a-z0-9_]{0,39}$' };
const str = (max: number, min = 1) => ({ type: 'string', minLength: min, maxLength: max });

export const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'title', 'summary', 'screens'],
  properties: {
    version: { type: 'integer', enum: [1] },
    title: str(80),
    summary: str(400),
    screens: {
      type: 'array', minItems: 1, maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'fields', 'actions'],
        properties: {
          id: ID,
          title: str(80),
          intro: str(400, 0),
          fields: {
            type: 'array', maxItems: 30,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'label', 'type', 'required'],
              properties: {
                id: ID,
                label: str(80),
                type: { type: 'string', enum: FIELD_TYPES },
                required: { type: 'boolean' },
                help: str(200, 0),
                placeholder: str(120, 0),
                options: { type: 'array', maxItems: 50, items: str(80) },
                columns: {
                  type: 'array', maxItems: 10,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'label', 'type'],
                    properties: { id: ID, label: str(60), type: { type: 'string', enum: ['text', 'number', 'date'] } },
                  },
                },
              },
            },
          },
          actions: {
            type: 'array', minItems: 1, maxItems: 5,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'label', 'does', 'output', 'writesFiles', 'sendsMessages'],
              properties: {
                id: ID,
                label: str(40),
                does: str(300),
                output: { type: 'string', enum: OUTPUT_TYPES },
                writesFiles: { type: 'boolean' },
                sendsMessages: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  },
} as const;

type Schema = { [k: string]: any };

/** Checks a value against the small JSON Schema subset used above. Returns readable error messages. */
export function checkSchema(value: unknown, schema: Schema, path = 'recipe', errors: string[] = []): string[] {
  const t = schema.type;
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
  if (t && actual !== t && !(t === 'number' && actual === 'integer')) {
    errors.push(`${path} should be ${t} but is ${actual}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path} must not be empty`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path} has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => checkSchema(v, schema.items, `${path}[${i}]`, errors));
  }
  if (actual === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in obj)) errors.push(`${path}.${k} is missing`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (sub) checkSchema(v, sub, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${k} is not allowed`);
    }
  }
  return errors;
}

function dupes(ids: string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) !== i);
}

/** Full validation: schema plus rules a schema can't express. Empty array means valid. */
export function validateRecipe(value: unknown): string[] {
  const errors = checkSchema(value, RECIPE_SCHEMA);
  if (errors.length) return errors;
  const r = value as Recipe;
  for (const d of dupes(r.screens.map((s) => s.id))) errors.push(`screen id "${d}" is used twice`);
  r.screens.forEach((s, si) => {
    for (const d of dupes(s.fields.map((f) => f.id))) errors.push(`screens[${si}] field id "${d}" is used twice`);
    for (const d of dupes(s.actions.map((a) => a.id))) errors.push(`screens[${si}] action id "${d}" is used twice`);
    s.fields.forEach((f, fi) => {
      const p = `screens[${si}].fields[${fi}]`;
      if (f.type === 'dropdown' && !f.options?.length) errors.push(`${p} is a dropdown, so it needs options`);
      if (f.type === 'table' && !f.columns?.length) errors.push(`${p} is a table, so it needs columns`);
      if (f.columns) for (const d of dupes(f.columns.map((c) => c.id))) errors.push(`${p} column id "${d}" is used twice`);
    });
  });
  return errors;
}

/** Same schema without the length/count/pattern limits, which model-side structured output may not support. We enforce them ourselves. */
export function schemaForModel(schema: Schema = RECIPE_SCHEMA): Schema {
  const out: Schema = {};
  for (const [k, v] of Object.entries(schema)) {
    if (['minLength', 'maxLength', 'maxItems', 'pattern'].includes(k)) continue;
    if (k === 'minItems' && (v as number) > 1) continue;
    if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v as Schema).map(([pk, pv]) => [pk, schemaForModel(pv)]));
    else if (k === 'items') out[k] = schemaForModel(v as Schema);
    else out[k] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

/** Used when the AI can't produce a valid recipe: one big text box. */
export function fallbackRecipe(title: string, summary: string): Recipe {
  return {
    version: 1,
    title: title.slice(0, 80) || 'AI helper',
    summary: (summary || 'Describe what you want and this helper will do it.').slice(0, 400),
    screens: [{
      id: 'main',
      title: title.slice(0, 80) || 'AI helper',
      fields: [{ id: 'request', label: 'Describe what you want', type: 'longtext', required: true }],
      actions: [{ id: 'run', label: 'Go', does: 'Sends your request to this helper and shows the answer.', output: 'text', writesFiles: false, sendsMessages: false }],
    }],
  };
}
