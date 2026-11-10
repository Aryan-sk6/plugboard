// Local Data Store: one SQLite file in Maginary's data folder. Every record belongs to one helper (its namespace),
// and every query is scoped to that helper, so one helper can never see another helper's records.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type RecordData = Record<string, unknown>;
export interface StoredRecord { id: number; data: RecordData; createdAt: string; updatedAt: string }

// shortcut: lists return at most this many records (newest first); add paging if a helper needs more.
export const MAX_LIST = 500;
const MAX_RECORD_BYTES = 200_000;

export class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY,
        plugin TEXT NOT NULL,
        collection TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS records_by_owner ON records (plugin, collection, id);
    `);
  }

  private row(r: any): StoredRecord {
    return { id: Number(r.id), data: JSON.parse(r.data), createdAt: r.created_at, updatedAt: r.updated_at };
  }

  list(plugin: string, collection: string, limit = MAX_LIST): StoredRecord[] {
    return this.db
      .prepare('SELECT * FROM records WHERE plugin = ? AND collection = ? ORDER BY id DESC LIMIT ?')
      .all(plugin, collection, limit)
      .map((r) => this.row(r));
  }

  get(plugin: string, collection: string, id: number): StoredRecord | null {
    const r = this.db.prepare('SELECT * FROM records WHERE plugin = ? AND collection = ? AND id = ?').get(plugin, collection, id);
    return r ? this.row(r) : null;
  }

  /**
   * Saves a record. If keyLabel is given and a record with the same value for it exists (ignoring case),
   * that record is updated instead of adding a duplicate (e.g. the same stock item).
   */
  save(plugin: string, collection: string, data: RecordData, keyLabel?: string): { id: number; updated: boolean } {
    const json = JSON.stringify(data);
    if (json.length > MAX_RECORD_BYTES) throw new Error('This record is too big to save.');
    const now = new Date().toISOString();
    const key = keyLabel ? String(data[keyLabel] ?? '').trim().toLowerCase() : '';
    if (key) {
      const existing = this.list(plugin, collection, 10_000).find((r) => String(r.data[keyLabel!] ?? '').trim().toLowerCase() === key);
      if (existing) {
        // Keep the original spelling of the name ("Rosa Diaz", not the "rosa diaz" just typed).
        const merged = { ...existing.data, ...data, [keyLabel!]: existing.data[keyLabel!] };
        this.db.prepare('UPDATE records SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), now, existing.id);
        return { id: existing.id, updated: true };
      }
    }
    const r = this.db.prepare('INSERT INTO records (plugin, collection, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(plugin, collection, json, now, now);
    return { id: Number(r.lastInsertRowid), updated: false };
  }

  remove(plugin: string, collection: string, id: number): boolean {
    return Number(this.db.prepare('DELETE FROM records WHERE plugin = ? AND collection = ? AND id = ?').run(plugin, collection, id).changes) > 0;
  }

  close() {
    this.db.close();
  }
}

/** A short name for a record, used in pick-a-record lists: a "name"-like field, else the first short text. */
export function recordLabel(data: RecordData): string {
  const entries = Object.entries(data);
  const named = entries.find(([k, v]) => /name|title|item|product/i.test(k) && typeof v === 'string' && v.trim());
  const first = named ?? entries.find(([, v]) => typeof v === 'string' && v.trim() && v.length <= 80);
  return first ? String(first[1]).trim().slice(0, 80) : 'Saved record';
}
