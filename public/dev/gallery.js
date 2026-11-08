// Developer test page: every fixed component, filled with SAMPLE data. Not real output.
import { renderRecipe, renderResult } from '../renderer.js';

const sample = {
  version: 1,
  title: 'Every component',
  summary: 'Sample recipe that uses each field type once.',
  screens: [
    {
      id: 'one',
      title: 'All field types',
      intro: 'Sample intro text.',
      fields: [
        { id: 'name', label: 'Customer name', type: 'text', required: true, placeholder: 'e.g. Rosa Diaz' },
        { id: 'notes', label: 'Notes', type: 'longtext', required: false, help: 'Anything else we should know.' },
        { id: 'qty', label: 'Quantity', type: 'number', required: true },
        { id: 'due', label: 'Due date', type: 'date', required: false },
        { id: 'tone', label: 'Tone', type: 'dropdown', required: true, options: ['Friendly', 'Formal'] },
        { id: 'agree', label: 'I checked the details', type: 'checkbox', required: true },
        { id: 'list', label: 'Price list', type: 'file', required: false },
        { id: 'lines', label: 'Items', type: 'table', required: true, columns: [{ id: 'item', label: 'Item', type: 'text' }, { id: 'price', label: 'Price', type: 'number' }, { id: 'when', label: 'Date', type: 'date' }] },
      ],
      actions: [
        { id: 'go', label: 'Check my answers', does: 'Checks the form and shows the values.', output: 'text', writesFiles: false, sendsMessages: false },
        { id: 'send', label: 'Send email', does: 'Would send an email to the customer.', output: 'text', writesFiles: false, sendsMessages: true },
      ],
    },
    { id: 'two', title: 'Second tab', fields: [{ id: 'x', label: 'Anything', type: 'text', required: false }], actions: [{ id: 'ok', label: 'OK', does: 'Shows the values.', output: 'text', writesFiles: true, sendsMessages: false }] },
  ],
};

const app = document.getElementById('app');
const out = document.createElement('div');
out.id = 'values';
app.append(
  renderRecipe(sample, async (screen, action, values) => {
    out.replaceChildren(renderResult({ kind: 'text', text: `SAMPLE: "${action.label}" on "${screen.title}" got these values:\n` + JSON.stringify(values, null, 2) }));
  }),
  out,
  renderResult({ kind: 'text', text: 'SAMPLE text result.\nSecond line, with <b>tags</b> that must show as plain text.' }),
  renderResult({ kind: 'table', columns: [{ id: 'item', label: 'Item' }, { id: 'qty', label: 'In stock' }], rows: [{ item: 'SAMPLE widget', qty: 12 }, { item: 'SAMPLE "quoted", item', qty: 0 }] }),
  renderResult({ kind: 'file', name: 'sample-invoice.txt', text: 'SAMPLE INVOICE\nTotal: 0.00' }),
  renderResult({ kind: 'error', text: 'SAMPLE error: Claude took too long to answer. Please try again.' }),
);
