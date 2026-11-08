#!/usr/bin/env node
// Starts Plugboard and opens it in the browser.
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createApp, OLD_DATA } from './server.ts';
import { defaultDataDir, copyOldData } from './paths.ts';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const wanted = portArg >= 0 ? Number(args[portArg + 1]) : 4567;
const noOpen = args.includes('--no-open');

function openBrowser(url: string) {
  const [cmd, cmdArgs] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  const child = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true });
  child.on('error', () => {}); // no browser opener: the printed link still works
  child.unref();
}

const dataDir = defaultDataDir();
try {
  if (copyOldData(OLD_DATA, dataDir)) console.log(`Moved your saved records to ${dataDir} (the old copy was left where it was).`);
} catch (err) {
  console.error(`Could not copy your old saved records to ${dataDir}: ${(err as Error).message}`);
}

const server = createApp({ dataDir });
function listen(port: number) {
  server.listen(port, '127.0.0.1');
}
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE' && portArg < 0) return listen(0); // default port busy: take any free one
  console.error(err.code === 'EADDRINUSE' ? `Port ${wanted} is already in use. Try a different number with --port.` : `Plugboard could not start: ${err.message}`);
  process.exit(1);
});
server.on('listening', () => {
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  console.log(`\nPlugboard is running.\nOpen this link in your browser if it did not open by itself: ${url}\nYour saved records are kept in: ${dataDir}\nTo stop Plugboard, close this window or press Ctrl+C.\n`);
  if (!noOpen) openBrowser(url);
});
listen(wanted);
