// Where Plugboard keeps the user's saved records and screen designs: Documents/Plugboard,
// so they survive updates and are easy to find and back up.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';

/** The user's real Documents folder. Windows may move it (e.g. into OneDrive, with a translated name), so we ask the system. */
export function documentsDir(platform = process.platform): string {
  const ask = (cmd: string, args: string[]) => {
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      const out = r.status === 0 ? r.stdout.trim() : '';
      return out && isAbsolute(out) && existsSync(out) ? out : '';
    } catch {
      return '';
    }
  };
  const found =
    platform === 'win32'
      ? ask('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')"])
      : platform === 'linux'
        ? ask('xdg-user-dir', ['DOCUMENTS'])
        : '';
  if (found && found !== homedir()) return found;
  const docs = join(homedir(), 'Documents');
  return existsSync(docs) ? docs : homedir();
}

let cached: string | null = null;

/** Plugboard's data folder: PLUGBOARD_DATA if set, otherwise Documents/Plugboard. */
export function defaultDataDir(): string {
  if (process.env.PLUGBOARD_DATA) return resolve(process.env.PLUGBOARD_DATA);
  return (cached ??= join(documentsDir(), 'Plugboard'));
}

/**
 * Earlier versions kept data inside the app's own data/ folder. If that exists and the new folder has no database yet,
 * copy it over once. The old folder is left untouched, so nothing can be lost.
 */
export function copyOldData(oldDir: string, newDir: string): boolean {
  if (resolve(oldDir) === resolve(newDir)) return false;
  if (!existsSync(join(oldDir, 'plugboard.db')) || existsSync(join(newDir, 'plugboard.db'))) return false;
  cpSync(oldDir, newDir, { recursive: true, errorOnExist: false, force: false });
  return true;
}
