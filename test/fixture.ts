// Builds a fake Claude config folder in the OS temp dir. Never touches the real one.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

async function put(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

export async function makeClaudeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'plugboard-test-'));
  await put(join(home, 'skills', 'invoice-maker', 'SKILL.md'), '---\nname: invoice-maker\ndescription: Makes invoices for customers.\n---\n\n# Invoice maker\nSteps...\n');
  await put(join(home, 'skills', 'folded', 'SKILL.md'), '---\r\nname: folded\r\ndescription: >\r\n  Line one\r\n  line two.\r\nmetadata:\r\n  version: "1"\r\n---\r\nbody\r\n');
  await put(join(home, 'skills', 'not-a-skill', 'README.md'), 'no SKILL.md here');
  await put(join(home, 'commands', 'follow-up.md'), '# Follow up\n\nWrite a friendly follow-up email to a customer.\n');
  await put(join(home, 'commands', 'ignored.toml'), 'not markdown');
  const pluginDir = join(home, 'plugins', 'cache', 'shop', 'stock', '1.0.0');
  await put(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'stock-tools' }));
  await put(join(pluginDir, 'skills', 'count-stock', 'SKILL.md'), '---\nname: count-stock\ndescription: "Counts stock, \\"fast\\"."\n---\n');
  await put(join(pluginDir, 'commands', 'reorder.md'), '---\ndescription: Reorder low items\n---\nDo it.\n');
  const offDir = join(home, 'plugins', 'cache', 'shop', 'off', '1.0.0');
  await put(join(offDir, 'skills', 'hidden', 'SKILL.md'), '---\nname: hidden\n---\n');
  await put(
    join(home, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'stock@shop': [{ scope: 'user', installPath: pluginDir }],
        'off@shop': [{ scope: 'user', installPath: offDir }],
        'gone@shop': [{ scope: 'user', installPath: join(home, 'does-not-exist') }],
      },
    }),
  );
  await put(join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'off@shop': false } }));
  return home;
}

/** A valid screen recipe used across tests. */
export function goodRecipe(): any {
  return {
    version: 1,
    title: 'Invoice maker',
    summary: 'Makes an invoice.',
    screens: [{
      id: 'main',
      title: 'New invoice',
      fields: [
        { id: 'customer', label: 'Customer name', type: 'text', required: true },
        { id: 'due', label: 'Due date', type: 'date', required: false },
        { id: 'currency', label: 'Currency', type: 'dropdown', required: true, options: ['USD', 'EUR'] },
        { id: 'lines', label: 'Items', type: 'table', required: true, columns: [{ id: 'item', label: 'Item', type: 'text' }, { id: 'price', label: 'Price', type: 'number' }] },
      ],
      actions: [{ id: 'make', label: 'Make invoice', does: 'Creates the invoice text.', output: 'text', writesFiles: false, sendsMessages: false }],
    }],
  };
}

/** Extra screens that save, list and recall records (customers). */
export function storeScreens(): any[] {
  return [
    {
      id: 'add',
      title: 'Add a customer',
      fields: [
        { id: 'name', label: 'Customer name', type: 'text', required: true },
        { id: 'email', label: 'Email', type: 'text', required: false },
      ],
      actions: [
        { id: 'save', label: 'Save customer', does: 'Saves this customer.', output: 'text', writesFiles: false, sendsMessages: false, kind: 'save', saveTo: 'customers', keyField: 'name' },
        { id: 'show', label: 'Show customers', does: 'Shows saved customers.', output: 'table', writesFiles: false, sendsMessages: false, kind: 'list', uses: 'customers' },
      ],
    },
    {
      id: 'write',
      title: 'Write to a customer',
      fields: [
        { id: 'who', label: 'Which customer?', type: 'record', required: true, collection: 'customers' },
        { id: 'topic', label: 'What about?', type: 'text', required: true },
      ],
      actions: [
        { id: 'draft', label: 'Write email', does: 'Drafts an email.', output: 'text', writesFiles: false, sendsMessages: false, uses: 'customers', saveTo: 'emails' },
      ],
    },
  ];
}
