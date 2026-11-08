// TEST DOUBLE ONLY: imitates the claude CLI's -p --output-format json reply. Never used outside tests.
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
});
