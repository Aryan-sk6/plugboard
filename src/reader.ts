// Plugin Reader: finds Claude Code skills, commands and plugins on this computer.
// STRICTLY READ-ONLY: this file only ever calls readFile/readdir. Never add a write here.
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

export type Kind = 'skill' | 'command';

export interface PluginItem {
  id: string;
  kind: Kind;
  name: string;
  description: string;
  /** Where it came from: "Your skills", "Your commands", or the plugin's name. */
  source: string;
  /** The SKILL.md or command .md file. */
  file: string;
}

/** Claude Code's config folder. CLAUDE_CONFIG_DIR is the CLI's own override. */
export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

/** Parses the `---` header block of a skill/command file. Handles plain, quoted and | / > block values. */
export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { data: {}, body: src };
  const data: Record<string, string> = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, raw] = kv;
    const cont: string[] = [];
    while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) cont.push(lines[++i]);
    const block = /^([|>])[-+]?$/.exec(raw);
    if (block) {
      const trimmed = cont.map((l) => l.trim());
      data[key] = (block[1] === '|' ? trimmed.join('\n') : trimmed.join(' ').replace(/\s+/g, ' ')).trim();
    } else if (raw === '' && cont.length) {
      continue; // nested map (e.g. metadata:) - not needed
    } else {
      data[key] = unquote([raw, ...cont.map((l) => l.trim())].join(' ').trim());
    }
  }
  return { data, body: src.slice(m[0].length) };
}

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n');
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** First meaningful line of the body, used when a file has no description. */
function firstLine(body: string): string {
  const line = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('<!--'));
  return (line ?? '').slice(0, 300);
}

async function readItem(file: string, kind: Kind, source: string, fallbackName: string, idPrefix: string): Promise<PluginItem | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null; // missing or unreadable: just not a tool
  }
  const { data, body } = parseFrontmatter(text);
  const name = data.name || fallbackName;
  return { id: `${idPrefix}:${kind}:${name}`, kind, name, description: data.description || firstLine(body), source, file };
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

async function mdFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

/** Skills (skills/<name>/SKILL.md) and commands (commands/*.md) inside one folder. */
async function scanFolder(root: string, skillSource: string, commandSource: string, idPrefix: string): Promise<PluginItem[]> {
  const skills = (await subdirs(join(root, 'skills'))).map((d) => readItem(join(root, 'skills', d, 'SKILL.md'), 'skill', skillSource, d, idPrefix));
  // shortcut: only top-level command files, not namespaced subfolders; add recursion if real plugins need it.
  const commands = (await mdFiles(join(root, 'commands'))).map((f) => readItem(join(root, 'commands', f), 'command', commandSource, basename(f, '.md'), idPrefix));
  return (await Promise.all([...skills, ...commands])).filter((x): x is PluginItem => x !== null);
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Installed plugins from plugins/installed_plugins.json, skipping ones the user turned off. */
async function scanPlugins(home: string): Promise<PluginItem[]> {
  const installed = await readJson(join(home, 'plugins', 'installed_plugins.json'));
  const settings = await readJson(join(home, 'settings.json'));
  const enabled: Record<string, boolean> = settings?.enabledPlugins ?? {};
  const plugins: Record<string, any[]> = installed?.plugins ?? {};
  const results = await Promise.all(
    Object.entries(plugins).map(async ([id, entries]) => {
      if (enabled[id] === false || !Array.isArray(entries)) return [];
      const entry = entries.find((e) => e?.scope === 'user') ?? entries[0];
      if (typeof entry?.installPath !== 'string') return [];
      const manifest = await readJson(join(entry.installPath, '.claude-plugin', 'plugin.json'));
      const name = typeof manifest?.name === 'string' ? manifest.name : id.split('@')[0];
      return scanFolder(entry.installPath, name, name, `plugin:${id}`);
    }),
  );
  return results.flat();
}

/** The instruction text of one skill or command. */
export async function readInstructions(item: PluginItem): Promise<string> {
  return (await readFile(item.file, 'utf8')).replace(/\r\n?/g, '\n');
}

/** Every skill and command Claude Code would load for this user. */
export async function listPlugins(home = claudeHome()): Promise<PluginItem[]> {
  const [own, plugins] = await Promise.all([scanFolder(home, 'Your skills', 'Your commands', 'user'), scanPlugins(home)]);
  return [...own, ...plugins];
}
