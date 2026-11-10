// Developer test page: every layout and result style, filled with SAMPLE data. Not real output.
import { renderRecipe, renderResult, showOf } from '../renderer.js';
import { iconEl, lookFor, COLORS, ICON_NAMES } from '../look.js';

const a = (id, label, extra = {}) => ({ id, label, does: `SAMPLE: ${label}.`, output: 'text', writesFiles: false, sendsMessages: false, ...extra });
const f = (id, label, type, extra = {}) => ({ id, label, type, required: false, ...extra });

const customers = [
  { name: 'SAMPLE Rosa Diaz', email: 'rosa@example.com', last: '2026-10-20' },
  { name: 'SAMPLE Ben Okafor', email: 'ben@example.com', last: '2026-11-01' },
];

const SAMPLES = [
  {
    key: 'invoice',
    recipe: {
      title: 'Invoicing', summary: 'SAMPLE: make an invoice and see it as a printed page, or write a cover email.',
      look: { color: 'green', icon: 'receipt' },
      screens: [
        {
          id: 'make', title: 'Make an invoice', layout: 'split', intro: 'Fill this in and the invoice appears on the right.',
          fields: [
            f('biz', 'Your business', 'longtext', { required: true, section: 'You' }),
            f('who', 'Customer name', 'text', { required: true, section: 'Customer', width: 'half' }),
            f('mail', 'Customer email', 'text', { section: 'Customer', width: 'half' }),
            f('no', 'Invoice number', 'text', { required: true, section: 'Invoice', width: 'half' }),
            f('date', 'Invoice date', 'date', { section: 'Invoice', width: 'half' }),
            f('cur', 'Currency', 'dropdown', { required: true, options: ['USD', 'EUR', 'GBP'], section: 'Invoice', width: 'half' }),
            f('tax', 'Tax rate (%)', 'number', { section: 'Invoice', width: 'half' }),
            f('items', 'What you are charging for', 'table', { required: true, section: 'Items', columns: [{ id: 'd', label: 'Description', type: 'text' }, { id: 'q', label: 'Quantity', type: 'number' }, { id: 'p', label: 'Price each', type: 'number' }] }),
          ],
          actions: [a('go', 'Create invoice', { output: 'file', writesFiles: true, show: 'document' })],
        },
        {
          id: 'mail', title: 'Cover email', layout: 'split',
          fields: [f('to', 'Who is it for?', 'text', { required: true }), f('tone', 'Tone', 'dropdown', { required: true, options: ['Friendly', 'Formal'] })],
          actions: [a('write', 'Write email', { show: 'email' })],
        },
      ],
    },
    run(action) {
      if (action.id === 'go') return { kind: 'file', name: 'SAMPLE-INV-0001.txt', mime: 'text/plain', text: 'SAMPLE INVOICE\n==============================================\nFROM: Sample Bakery\nBILL TO: SAMPLE Rosa Diaz\n\nDescription               Qty   Price     Total\nSourdough loaf              6    7.00     42.00\nBirthday cake               1   38.00     38.00\n----------------------------------------------\nSubtotal:                              80.00\nTax (5%):                               4.00\nTOTAL DUE:                             84.00\n' };
      return { kind: 'text', text: "Here's your email.\n\nTo: rosa@example.com\nSubject: Thank you for your order, Rosa!\n\nHi Rosa,\n\nThank you so much for your recent order. I hope **everyone enjoyed it**.\n\n- Two dozen rolls\n- One birthday cake\n\nWarm wishes,\n[Your name]" };
    },
  },
  {
    key: 'customers',
    recipe: {
      title: 'Customer follow-up', summary: 'SAMPLE: keep a customer list. The list is always on screen, with a small form beside it.',
      look: { color: 'rose', icon: 'users' },
      screens: [{
        id: 'add', title: 'Your customers', layout: 'data', intro: 'Add a customer, or use the same name again to update them.',
        fields: [
          f('name', 'Customer name', 'text', { required: true, section: 'Who' }),
          f('email', 'Email address', 'text', { section: 'Who', width: 'half' }),
          f('last', 'When you last spoke', 'date', { section: 'Who', width: 'half' }),
          f('notes', 'Notes', 'longtext', { section: 'About them' }),
        ],
        actions: [a('save', 'Save customer', { kind: 'save', saveTo: 'customers', keyField: 'name' }), a('show', 'Show customers', { kind: 'list', uses: 'customers', output: 'table' })],
      }],
    },
    run(action, values) {
      if (action.kind === 'save') {
        if (values.name) customers.unshift({ name: String(values.name), email: String(values.email || ''), last: String(values.last || '') });
        return { kind: 'saved', text: 'Saved to your customers.' };
      }
      return {
        kind: 'records', collection: 'customers',
        columns: [{ id: 'c0', label: 'Customer name' }, { id: 'c1', label: 'Email address' }, { id: 'c2', label: 'Last spoke' }, { id: 'saved', label: 'Saved' }],
        rows: customers.map((c, i) => ({ _id: String(i), c0: c.name, c1: c.email, c2: c.last, saved: '2026-11-09' })),
      };
    },
    onDelete(row) { customers.splice(Number(row._id), 1); },
  },
  {
    key: 'steps',
    recipe: {
      title: 'Pricing helper', summary: 'SAMPLE: a longer form, one section at a time.',
      look: { color: 'violet', icon: 'tag' },
      screens: [{
        id: 'p', title: 'Help me price', layout: 'steps',
        fields: [
          f('what', 'What do you sell?', 'longtext', { required: true, section: 'Your business' }),
          f('kind', 'What kind of business is it?', 'dropdown', { required: true, options: ['Online store', 'Service', 'Software'], section: 'Your business', width: 'half' }),
          f('who', 'Who are your customers?', 'dropdown', { options: ['People', 'Small businesses', 'Large companies'], section: 'Your business', width: 'half' }),
          f('now', 'What do you charge today?', 'text', { section: 'Your prices', width: 'half' }),
          f('count', 'How many customers do you have?', 'number', { section: 'Your prices', width: 'half' }),
          f('rivals', 'What do others charge?', 'table', { section: 'Your prices', columns: [{ id: 'n', label: 'Who', type: 'text' }, { id: 'c', label: 'Their price', type: 'number' }] }),
          f('goal', 'What matters most right now?', 'dropdown', { required: true, options: ['Growing faster', 'Making more money'], section: 'Your goal' }),
          f('urgent', 'I need an answer this week', 'checkbox', { section: 'Your goal' }),
        ],
        actions: [a('go', 'Get my pricing advice', { show: 'document' })],
      }],
    },
    run() {
      return { kind: 'text', text: '# Pricing recommendation\n\n**Short answer:** raise single items by about 10%, then watch sales for two weeks.\n\n## Why\n\n- You are **below** the going rate.\n- Your customers value the handmade story.\n\n## Next steps\n\n1. Change the price on your shop.\n2. Update your market signs.\n3. Write down weekly sales.' };
    },
  },
  {
    key: 'plain',
    recipe: {
      title: 'Inventory', summary: 'SAMPLE: a plain form with a table result and a plain text result.',
      look: { color: 'orange', icon: 'box' },
      screens: [{
        id: 'r', title: 'What should I reorder?',
        fields: [f('weeks', 'Weeks of stock to cover (optional)', 'number', { width: 'half' }), f('sup', 'Only this supplier', 'text', { width: 'half' }), f('list', 'Price list', 'file'), f('ok', 'Include items that are fine', 'checkbox')],
        actions: [a('table', 'Make reorder list', { output: 'table' }), a('tip', 'Give me a tip')],
      }],
    },
    run(action) {
      if (action.id === 'table') {
        return { kind: 'table', note: 'SAMPLE: 2 of your 3 products need reordering.', columns: [{ id: 'a', label: 'Product' }, { id: 'b', label: 'In stock' }, { id: 'c', label: 'Suggested order' }, { id: 'd', label: 'Estimated cost' }], rows: [{ a: 'SAMPLE Flour 5kg', b: '2', c: '8', d: '72.00' }, { a: 'SAMPLE "Quoted", box', b: '3', c: '17', d: '13.60' }] };
      }
      return { kind: 'text', text: 'SAMPLE tip: **count stock on the same day** each week. Text like <b>this</b> must stay plain text.' };
    },
  },
];

const tabs = document.getElementById('samples');
const stage = document.getElementById('stage');

function show(sample, button) {
  [...tabs.children].forEach((b) => b.setAttribute('aria-selected', String(b === button)));
  const { recipe } = sample;
  const look = lookFor(recipe.title, recipe.look);
  stage.replaceChildren();
  const tool = document.createElement('div');
  tool.className = 'tool';
  tool.dataset.accent = look.color;
  const hero = document.createElement('div');
  hero.className = 'hero';
  const big = document.createElement('span');
  big.className = 'tile xl';
  big.append(iconEl(look.icon, 32));
  const words = document.createElement('div');
  const h = document.createElement('h2');
  h.className = 'tool-title';
  h.textContent = recipe.title;
  const p = document.createElement('p');
  p.className = 'lede';
  p.textContent = recipe.summary;
  words.append(h, p);
  hero.append(big, words);
  const form = renderRecipe(recipe, async (screen, action, values, slots) => {
    const result = sample.run(action, values);
    const onDelete = async (row) => {
      sample.onDelete(row);
      slots.results.replaceChildren(renderResult(sample.run(action, values), { onDelete, show: showOf(action) }));
    };
    if (result.kind === 'saved' && slots.toast) {
      slots.toast.replaceChildren(Object.assign(document.createElement('p'), { className: 'saved-line', textContent: '✓ ' + result.text }));
      const list = screen.actions.find((x) => x.kind === 'list');
      slots.results.replaceChildren(renderResult(sample.run(list, {}), { onDelete, show: 'plain' }));
      return;
    }
    slots.results.replaceChildren(renderResult(result, { onDelete, show: showOf(action) }));
  });
  tool.append(hero, form);
  stage.append(tool);
}

for (const sample of SAMPLES) {
  const b = document.createElement('button');
  b.className = 'tab';
  b.type = 'button';
  b.textContent = sample.recipe.title;
  b.addEventListener('click', () => show(sample, b));
  tabs.append(b);
}

// A swatch strip so every color and icon on the menu can be checked at a glance.
const swatches = document.createElement('div');
swatches.className = 'cards';
swatches.style.marginTop = '28px';
COLORS.forEach((color, i) => {
  const item = document.createElement('div');
  item.className = 'card';
  item.dataset.accent = color;
  const top = document.createElement('div');
  top.className = 'card-top';
  const t = document.createElement('span');
  t.className = 'tile lg';
  t.append(iconEl(ICON_NAMES[i % ICON_NAMES.length], 24));
  top.append(t, Object.assign(document.createElement('span'), { className: 'tag', textContent: color }));
  item.append(top, Object.assign(document.createElement('p'), { className: 'desc', textContent: `SAMPLE ${color} with the ${ICON_NAMES[i % ICON_NAMES.length]} icon` }));
  swatches.append(item);
});
document.getElementById('app').append(swatches);

tabs.firstElementChild.click();
