// TEST DOUBLE ONLY: imitates the claude CLI's -p --output-format json reply. Never used outside tests.
import { readFileSync, writeFileSync } from 'node:fs';

// Sign-in state lives in a temp file named by FAKE_STATE ("1" = signed in).
const argv = process.argv.slice(2);
const signedIn = () => { try { return readFileSync(process.env.FAKE_STATE, 'utf8') === '1'; } catch { return false; } };
if (argv[0] === 'auth' && argv[1] === 'status') {
  process.stdout.write(JSON.stringify({ loggedIn: signedIn(), authMethod: signedIn() ? 'claude.ai' : 'none', configDirectory: '/x' }));
  process.exit(signedIn() ? 0 : 1);
}
if (argv[0] === 'auth' && argv[1] === 'login') {
  process.stdout.write('Opening browser to sign in…\nIf the browser didn\'t open, visit: https://claude.ai/oauth/authorize?code=true&state=abc\n');
  if (process.env.FAKE_LOGIN === 'code') {
    process.stdout.write('Paste code here if prompted > ');
    process.stdin.once('data', (c) => {
      writeFileSync(process.env.FAKE_STATE, String(c).trim() === 'good-code' ? '1' : '0');
      process.exit(String(c).trim() === 'good-code' ? 0 : 1);
    });
  } else {
    setTimeout(() => { writeFileSync(process.env.FAKE_STATE, '1'); process.exit(0); }, 300);
  }
} else {
let stdin = '';
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  const mode = process.env.FAKE_MODE;
  const out = (o) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...o }));
  if (mode === 'echo') return out({ result: JSON.stringify({ args: process.argv.slice(2), stdin }) });
  if (mode === 'structured') return out({ result: '', structured_output: { ok: true } });
  if (mode === 'notlogged') return out({ is_error: true, result: 'Not logged in · Please run /login' });
  if (mode === 'limit') return out({ is_error: true, result: 'You have hit your usage limit. Resets at 5pm.' });
  if (mode === 'garbage') return process.stdout.write('this is not json');
  if (mode === 'hang') return setTimeout(() => {}, 60_000);
  const line = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const delta = (d) => line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: d } });
  if (mode === 'stream') {
    line({ type: 'system', subtype: 'init' });
    delta({ type: 'text_delta', text: 'Hello ' });
    delta({ type: 'text_delta', text: 'there' });
    delta({ type: 'input_json_delta', partial_json: '{"a":' });
    // the result line arrives in two pieces, to test line buffering
    const r = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Hello there', credential_expires_at: 'x' });
    process.stdout.write(r.slice(0, 10));
    return setTimeout(() => process.stdout.write(r.slice(10) + '\n'), 50);
  }
  if (mode === 'streamhang') {
    delta({ type: 'text_delta', text: 'partial' });
    return setTimeout(() => {}, 60_000);
  }
});
}
