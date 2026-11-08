// Turns form answers into saved records and saved records into tables.
// Records are keyed by the field's on-screen label, so they stay readable even if the screen is redesigned later.
import type { Screen } from './recipe.ts';
import { recordLabel, type RecordData, type StoredRecord, type Store } from './store.ts';

/** A picked record as the Runner sees it. */
export interface PickedRecord { picked: string; data: RecordData }

/** Replaces each "pick a saved record" answer (a record id) with the record itself, from this helper's own records only. */
export function resolvePicks(screen: Screen, values: Record<string, unknown>, store: Store, plugin: string): Record<string, unknown> {
  const out = { ...values };
  for (const f of screen.fields) {
    if (f.type !== 'record' || !f.collection) continue;
    const id = Number(values[f.id]);
    const rec = Number.isInteger(id) && id > 0 ? store.get(plugin, f.collection, id) : null;
    out[f.id] = rec ? ({ picked: recordLabel(rec.data), data: rec.data } satisfies PickedRecord) : '';
  }
  return out;
}

/** The answers to store, using labels as keys. Only fields the screen defines are kept. */
export function toRecord(screen: Screen, values: Record<string, unknown>): RecordData {
  const data: RecordData = {};
  for (const f of screen.fields) {
    const v = values[f.id];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (f.type === 'checkbox') data[f.label] = v === true ? 'Yes' : 'No';
    else if (f.type === 'file') data[f.label] = String((v as { name?: unknown }).name ?? 'file');
    else if (f.type === 'record') data[f.label] = (v as PickedRecord).picked ?? '';
    else if (f.type === 'table' && Array.isArray(v)) {
      const cols = f.columns ?? [];
      data[f.label] = v.map((row: any) => Object.fromEntries(cols.map((c) => [c.label, row?.[c.id] ?? ''])));
    } else data[f.label] = typeof v === 'number' ? v : String(v);
  }
  return data;
}

function cellText(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (v && typeof v === 'object') return recordLabel(v as RecordData);
  return String(v ?? '');
}

/** YYYY-MM-DD in this computer's time zone (the server runs on the user's own computer). */
export function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Saved records as a table for the Results View. Each row keeps its record id so it can be deleted. */
export function recordsTable(collection: string, records: StoredRecord[]) {
  const labels: string[] = [];
  for (const r of records) for (const k of Object.keys(r.data)) if (!labels.includes(k)) labels.push(k);
  const columns = [...labels.map((label, i) => ({ id: `c${i}`, label })), { id: 'saved', label: 'Saved' }];
  const rows = records.map((r) => ({
    _id: String(r.id),
    ...Object.fromEntries(labels.map((l, i) => [`c${i}`, cellText(r.data[l])])),
    saved: localDate(r.updatedAt),
  }));
  return { kind: 'records' as const, collection, columns, rows };
}

/** Saved records as text the AI can read. */
export function recordsForPrompt(collection: string, records: StoredRecord[], maxChars = 60_000): string {
  const body = records.map((r) => JSON.stringify(r.data)).join('\n');
  return `Saved ${collection} (${records.length}, newest first, one per line):\n${body.slice(0, maxChars)}`;
}
