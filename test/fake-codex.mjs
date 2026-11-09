// TEST DOUBLE ONLY: imitates the codex CLI (`codex exec --json`, `codex login`, `codex login status`). Never used outside tests.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const signedIn = () => { try { return readFileSync(process.env.FAKE_STATE, 'utf8') === '1'; } catch { return false; } };
const ev = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (argv[0] === 'login' && argv[1] === 'status') {
  if (signedIn()) { console.log('Logged in using ChatGPT'); process.exit(0); }
  console.error('Not logged in');
  process.exit(1);
} else if (argv[0] === 'login') {
  process.stdout.write("Opening browser to sign in...\nIf it didn't open, visit: https://auth.openai.com/oauth/authorize?x=1\n");
  setTimeout(() => { writeFileSync(process.env.FAKE_STATE, '1'); process.exit(0); }, 300);
} else {
  let stdin = '';
  process.stdin.on('data', (c) => (stdin += c));
  process.stdin.on('end', () => {
    const mode = process.env.FAKE_MODE;
    const message = (text) => ev({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text } });
    ev({ type: 'thread.started', thread_id: 't' });
    ev({ type: 'turn.started' });
    if (mode === 'echo') {
      const s = argv.indexOf('--output-schema');
      message(JSON.stringify({ args: argv, stdin, cwd: process.cwd(), cwdFiles: readdirSync(process.cwd()), schema: s >= 0 ? JSON.parse(readFileSync(argv[s + 1], 'utf8')) : null }));
    } else if (mode === 'reply') message(process.env.FAKE_CODEX_REPLY);
    else if (mode === 'two') { message('I will think first.'); message('Final answer.'); }
    else if (mode === 'failed') { ev({ type: 'turn.failed', error: { message: process.env.FAKE_CODEX_ERROR } }); process.exit(1); }
    else if (mode === 'error') { message('partial text'); ev({ type: 'error', message: process.env.FAKE_CODEX_ERROR }); }
    else if (mode === 'hang') { message('started'); return setTimeout(() => {}, 60_000); }
    // 'nomessage' and unknown modes: no answer at all
    ev({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
  });
}
