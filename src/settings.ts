// Maginary's small settings file (which AI to use), kept in the user's data folder.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isProviderId, type ProviderId } from './providers.ts';

export function readProvider(dataDir: string): ProviderId {
  try {
    const p = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).provider;
    return isProviderId(p) ? p : 'claude';
  } catch {
    return 'claude'; // no file yet, or unreadable
  }
}

export function writeProvider(dataDir: string, provider: ProviderId): void {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'settings.json');
  writeFileSync(file + '.tmp', JSON.stringify({ provider }, null, 2));
  renameSync(file + '.tmp', file);
}
