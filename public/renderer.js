// Renderer: turns a screen recipe into real form controls from a FIXED set of components.
// Recipe text is untrusted: it is only ever set with textContent / attributes, never as HTML, and never executed.

// shortcut: only text-like files are read, up to this size; add PDF/image support when the Runner can pass files to the AI.
export const MAX_FILE_BYTES = 200_000;
const TEXT_FILE = /\.(txt|csv|tsv|md|json|xml|html?|log|ya?ml)$/i;

// ---------- pure helpers (also used by tests in Node) ----------

function isEmpty(v) {
  return v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

/** Checks form values against the recipe. Returns { fieldId: plain-language problem }. */
export function validateValues(screen, values) {
  const errors = {};
  for (const f of screen.fields) {
    const v = values[f.id];
    if (f.type === 'checkbox') {
      if (f.required && v !== true) errors[f.id] = 'Please tick this box.';
      continue;
    }
    if (isEmpty(v)) {
      const missing = { table: 'Please fill in at least one row.', file: 'Please choose a file.', dropdown: 'Please pick one of the choices.', date: 'Please pick a date.', record: 'Please pick one from your saved list.' };
      if (f.required) errors[f.id] = missing[f.type] || 'Please fill this in.';
      continue;
    }
    if (f.type === 'number' && !Number.isFinite(v)) errors[f.id] = 'Please enter a number, like 12 or 4.5.';
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[f.id] = 'Please pick a date.';
    if (f.type === 'dropdown' && !(f.options || []).includes(v)) errors[f.id] = 'Please pick one of the choices.';
    if (f.type === 'table') {
      const bad = v.findIndex((row) => (f.columns || []).some((c) => c.type === 'number' && row[c.id] !== '' && row[c.id] != null && !Number.isFinite(row[c.id])));
      if (bad >= 0) errors[f.id] = `Row ${bad + 1} has something that isn't a number in a number column.`;
    }
  }
  return errors;
}

/** "12" -> 12, "" -> "", "abc" -> NaN (so validation can complain). */
export function toNumber(s) {
  const t = String(s).trim().replace(/,/g, '');
  return t === '' ? '' : Number(t);
}

/** Keeps table rows that have at least one cell filled in. */
export function cleanRows(rows) {
  return rows.filter((r) => Object.values(r).some((v) => !isEmpty(v)));
}

/** Can this file be read as text for the AI? Returns a problem message or null. */
export function fileProblem(name, size) {
  if (!TEXT_FILE.test(name)) return 'For now Plugboard can read text files only, like .txt, .csv or .md.';
  if (size > MAX_FILE_BYTES) return `This file is too big. Please use a file under ${Math.round(MAX_FILE_BYTES / 1000)} KB.`;
  return null;
}

/**
 * Splits AI text into simple blocks: headings, paragraphs, bullet/numbered lists and tables.
 * Only these shapes are recognised; anything else stays plain text. Nothing is ever treated as HTML.
 */
export function parseMarkdown(text) {
  const blocks = [];
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      blocks.push({ type: 'h', text: h[2].replace(/\s+#+\s*$/, '') });
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      blocks.push({ type: 'table', rows });
    } else if (li) {
      flush();
      const ordered = /\d/.test(li[1]);
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'list' && last.ordered === ordered) last.items.push(li[2]);
      else blocks.push({ type: 'list', ordered, items: [li[2]] });
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) flush();
    else para.push(line);
  }
  flush();
  return blocks;
}

/** Splits a line into plain, **bold** and `code` pieces. */
export function parseInline(text) {
  return String(text)
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter(Boolean)
    .map((part) => (/^\*\*.+\*\*$/.test(part) ? { b: part.slice(2, -2) } : /^`.+`$/.test(part) ? { code: part.slice(1, -1) } : { t: part }));
}

// ---------- DOM ----------

function inline(node, text) {
  for (const piece of parseInline(text)) node.append(piece.b != null ? el('strong', null, piece.b) : piece.code != null ? el('code', null, piece.code) : document.createTextNode(piece.t));
  return node;
}

/** Shows AI text with simple formatting, built element by element (never innerHTML). */
export function renderMarkdown(text) {
  const box = el('div', 'result-text formatted');
  for (const b of parseMarkdown(text)) {
    if (b.type === 'h') box.append(inline(el('h4'), b.text));
    else if (b.type === 'p') box.append(inline(el('p'), b.text));
    else if (b.type === 'list') {
      const list = el(b.ordered ? 'ol' : 'ul');
      for (const it of b.items) list.append(inline(el('li'), it));
      box.append(list);
    } else if (b.type === 'table' && b.rows.length) {
      const scroller = el('div', 'table-scroll');
      const table = el('table', 'data');
      const [head, ...rest] = b.rows;
      const tr = el('tr');
      for (const c of head) tr.append(inline(el('th'), c));
      table.append(el('thead'), el('tbody'));
      table.tHead.append(tr);
      for (const r of rest) {
        const row = el('tr');
        for (const c of r) row.append(inline(el('td'), c));
        table.tBodies[0].append(row);
      }
      scroller.append(table);
      box.append(scroller);
    }
  }
  return box;
}

let uid = 0;
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function cellInput(type, label) {
  const input = el('input');
  input.type = type === 'date' ? 'date' : 'text';
  if (type === 'number') input.inputMode = 'decimal';
  input.setAttribute('aria-label', label);
  return input;
}

/** Builds one field. Returns { node, get, setError, focus, reload? }. */
function buildField(f, opts = {}) {
  const id = `f${++uid}`;
  const wrap = el('div', `field field-${f.type}`);
  const label = el('label', 'field-label', f.label);
  label.htmlFor = id;
  label.id = id + '-label';
  if (f.required) label.append(el('span', 'needed', ' (needed)'));
  const help = f.help ? el('p', 'help', f.help) : null;
  const error = el('p', 'field-error');
  error.id = id + '-err';
  error.hidden = true;
  if (help) help.id = id + '-help';
  let control;
  let get;
  let reload = null;

  switch (f.type) {
    case 'longtext':
      control = el('textarea');
      control.rows = 4;
      control.maxLength = 20000;
      get = () => control.value;
      break;
    case 'number':
      control = el('input');
      control.type = 'text'; // type=number silently drops "1,200"; we parse ourselves and explain mistakes
      control.inputMode = 'decimal';
      get = () => toNumber(control.value);
      break;
    case 'date':
      control = el('input');
      control.type = 'date';
      get = () => control.value;
      break;
    case 'dropdown': {
      control = el('select');
      const blank = el('option', null, 'Choose…');
      blank.value = '';
      control.append(blank);
      for (const o of f.options || []) {
        const opt = el('option', null, o);
        opt.value = o;
        control.append(opt);
      }
      get = () => control.value;
      break;
    }
    case 'checkbox': {
      control = el('input');
      control.type = 'checkbox';
      get = () => control.checked;
      wrap.classList.add('inline');
      break;
    }
    case 'file': {
      control = el('input');
      control.type = 'file';
      control.accept = '.txt,.csv,.tsv,.md,.json,.xml,.html,.log,.yaml,.yml';
      let value = null;
      control.addEventListener('change', async () => {
        value = null;
        const file = control.files && control.files[0];
        if (!file) return;
        const problem = fileProblem(file.name, file.size);
        if (problem) {
          control.value = '';
          setError(problem);
          return;
        }
        setError(null);
        value = { name: file.name, size: file.size, text: await file.text() };
      });
      get = () => value;
      break;
    }
    case 'table':
      ({ control, get } = buildTable(f, id));
      break;
    case 'record': {
      // Pick one of this helper's saved records. The value sent is the record's id; the server looks it up.
      control = el('select');
      const select = control;
      get = () => select.value;
      reload = async () => {
        const keep = select.value;
        let records = [];
        try {
          records = opts.loadRecords ? await opts.loadRecords(f.collection) : [];
        } catch {
          records = null;
        }
        const first = el('option', null, records === null ? "Couldn't load your saved list" : records.length ? 'Choose…' : `Nothing saved in your ${f.collection} yet`);
        first.value = '';
        select.replaceChildren(first);
        for (const r of records || []) {
          const opt = el('option', null, r.label);
          opt.value = String(r.id);
          select.append(opt);
        }
        if ([...select.options].some((o) => o.value === keep)) select.value = keep;
      };
      reload();
      break;
    }
    default: // text, and anything unexpected falls back to a plain text box
      control = el('input');
      control.type = 'text';
      control.maxLength = 500;
      get = () => control.value;
  }
  if (f.placeholder && 'placeholder' in control) control.placeholder = f.placeholder;
  control.id = id;
  const described = [help && help.id, error.id].filter(Boolean).join(' ');
  if (f.type !== 'table') control.setAttribute('aria-describedby', described);

  function setError(msg) {
    error.hidden = !msg;
    error.textContent = msg || '';
    const target = f.type === 'table' ? control.querySelector('input') || control : control;
    if (msg) target.setAttribute('aria-invalid', 'true');
    else target.removeAttribute('aria-invalid');
  }

  if (f.type === 'checkbox') {
    const row = el('div', 'check-row');
    row.append(control, label);
    wrap.append(row);
  } else {
    wrap.append(label, control);
  }
  if (help) wrap.append(help);
  wrap.append(error);
  return { node: wrap, get, setError, reload, focus: () => (control.querySelector?.('input') || control).focus() };
}

function buildTable(f, id) {
  const columns = f.columns || [];
  const box = el('div', 'table-field');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-labelledby', id + '-label');
  const scroller = el('div', 'table-scroll');
  const table = el('table');
  const head = el('tr');
  for (const c of columns) head.append(el('th', null, c.label));
  head.append(el('th', 'sr-only', 'Remove'));
  table.append(el('thead'), el('tbody'));
  table.tHead.append(head);
  const rows = [];

  function addRow() {
    const tr = el('tr');
    const inputs = {};
    for (const c of columns) {
      const td = el('td');
      const input = cellInput(c.type, `${c.label}, row ${rows.length + 1}`);
      inputs[c.id] = input;
      td.append(input);
      tr.append(td);
    }
    const rm = el('button', 'link-button', 'Remove');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Remove this row');
    const entry = { tr, inputs };
    rm.addEventListener('click', () => {
      rows.splice(rows.indexOf(entry), 1);
      tr.remove();
      if (rows.length === 0) addRow();
    });
    const td = el('td');
    td.append(rm);
    tr.append(td);
    rows.push(entry);
    table.tBodies[0].append(tr);
    return entry;
  }

  addRow();
  const add = el('button', 'secondary', '+ Add row');
  add.type = 'button';
  add.addEventListener('click', () => {
    const entry = addRow();
    Object.values(entry.inputs)[0]?.focus();
  });
  scroller.append(table);
  box.append(scroller, add);
  const get = () =>
    cleanRows(rows.map(({ inputs }) => Object.fromEntries(columns.map((c) => [c.id, c.type === 'number' ? toNumber(inputs[c.id].value) : inputs[c.id].value]))));
  return { control: box, get };
}

/** Spreadsheet text. Cells starting with = + - @ get a leading quote so spreadsheet apps don't run them as formulas. */
export function toCsv(columns, rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => r[c.id]))].map((cells) => cells.map(cell).join(',')).join('\r\n');
}

/** Simple yes/no box. Resolves true if the user agrees. */
export function confirmBox(title, text, yesLabel = 'Yes, go ahead') {
  return confirmAction({ does: text }, title, yesLabel);
}

/** Shows an "are you sure" box for actions that write files or send messages. Resolves true if the user agrees. */
export function confirmAction(action, title = 'Before this runs', yesLabel = 'Yes, go ahead') {
  return new Promise((resolve) => {
    const dialog = el('dialog', 'confirm');
    dialog.append(el('h3', null, title), el('p', null, action.does));
    const list = el('ul');
    if (action.writesFiles) list.append(el('li', null, 'This makes a file for you to download. Plugboard does not change any files on your computer.'));
    if (action.sendsMessages) list.append(el('li', null, 'This will send messages or emails on your behalf.'));
    const row = el('div', 'action');
    const yes = el('button', null, yesLabel);
    const no = el('button', 'secondary', 'Cancel');
    row.append(yes, no);
    dialog.append(list, row);
    const done = (ok) => {
      dialog.close();
      dialog.remove();
      resolve(ok);
    };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    no.focus(); // safe choice is focused first
  });
}

/**
 * Renders a whole recipe: tabs if it has several screens, fields, and buttons.
 * onAction(screen, action, values) is called after the form checks out (and the user confirmed, if needed).
 * opts.loadRecords(collection) returns [{ id, label }] for "pick a saved record" fields.
 */
export function renderRecipe(recipe, onAction, opts = {}) {
  const root = el('div', 'recipe');
  const screens = recipe.screens;
  let tabs = null;
  const panels = [];
  const reloaders = [];
  /** Refreshes every "pick a saved record" list, e.g. after something was saved or deleted. */
  root.refreshRecords = () => Promise.all(reloaders.map((r) => r()));

  if (screens.length > 1) {
    tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    root.append(tabs);
  }

  screens.forEach((screen, i) => {
    const panel = el('form', 'panel');
    panel.noValidate = true;
    panel.addEventListener('submit', (e) => e.preventDefault());
    panel.append(el('h3', null, screen.title));
    if (screen.intro) panel.append(el('p', 'muted', screen.intro));
    const fields = screen.fields.map((f) => ({ f, ui: buildField(f, opts) }));
    for (const { ui } of fields) {
      panel.append(ui.node);
      if (ui.reload) reloaders.push(ui.reload);
    }

    const values = () => Object.fromEntries(fields.map(({ f, ui }) => [f.id, ui.get()]));
    const row = el('div', 'action actions');
    for (const action of screen.actions) {
      const btn = el('button', null, action.label);
      btn.type = 'button';
      const desc = el('p', 'help', action.does);
      desc.id = `a${++uid}`;
      btn.setAttribute('aria-describedby', desc.id);
      btn.addEventListener('click', async () => {
        const vals = values();
        const errors = action.kind === 'list' ? {} : validateValues(screen, vals); // showing a list needs no answers
        let first = null;
        for (const { f, ui } of fields) {
          ui.setError(errors[f.id] || null);
          if (errors[f.id] && !first) first = ui;
        }
        if (first) return first.focus();
        if ((action.writesFiles || action.sendsMessages) && !(await confirmAction(action))) return;
        btn.disabled = true;
        try {
          await onAction(screen, action, vals);
        } finally {
          btn.disabled = false;
          if (action.kind === 'save' || action.saveTo) root.refreshRecords();
        }
      });
      const itemBox = el('div', 'action-item');
      itemBox.append(btn, desc);
      row.append(itemBox);
    }
    panel.append(row);
    panels.push(panel);
    root.append(panel);

    if (tabs) {
      const tab = el('button', 'tab', screen.title);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => show(i));
      tabs.append(tab);
    }
  });

  function show(i) {
    panels.forEach((p, j) => (p.hidden = j !== i));
    if (tabs) [...tabs.children].forEach((t, j) => t.setAttribute('aria-selected', String(j === i)));
  }
  show(0);
  return root;
}

/**
 * Result panel. result is one of:
 *   { kind: 'text', text }
 *   { kind: 'table', columns: [{ id, label }], rows: [{...}] }
 *   { kind: 'file', name, text, mime? }
 *   { kind: 'records', collection, columns, rows: [{ _id, ...}] }   saved records, with Delete buttons
 *   { kind: 'saved', text }
 *   { kind: 'error', text }
 * Any result may carry savedNote. opts.onDelete(row) is called when a saved record's Delete is confirmed.
 */
export function renderResult(result, opts = {}) {
  const box = el('section', 'panel result');
  box.setAttribute('aria-live', 'polite');
  const titles = { error: 'Something went wrong', saved: 'Saved', records: `Your saved ${result.collection || 'records'}` };
  box.append(el('h3', null, titles[result.kind] || 'Result'));

  if (result.kind === 'error') {
    box.classList.add('result-error');
    box.append(el('p', null, result.text));
    return box;
  }
  if (result.note) box.append(el('p', null, result.note));
  if (result.savedNote) box.append(el('p', 'notice', '✓ ' + result.savedNote));

  if (result.kind === 'saved') {
    box.append(el('p', null, '✓ ' + result.text));
    return box;
  }

  if (result.kind === 'table' || result.kind === 'records') {
    if (result.rows.length === 0) {
      box.append(el('p', 'muted', 'Nothing saved here yet.'));
      return box;
    }
    const scroller = el('div', 'table-scroll');
    const table = el('table', 'data');
    const head = el('tr');
    for (const c of result.columns) head.append(el('th', null, c.label));
    if (result.kind === 'records') head.append(el('th', 'sr-only', 'Delete'));
    table.append(el('thead'), el('tbody'));
    table.tHead.append(head);
    for (const row of result.rows) {
      const tr = el('tr');
      for (const c of result.columns) tr.append(el('td', null, row[c.id] == null ? '' : String(row[c.id])));
      if (result.kind === 'records') {
        const del = el('button', 'link-button', 'Delete');
        del.type = 'button';
        del.setAttribute('aria-label', `Delete ${row[result.columns[0].id] || 'this record'}`);
        del.addEventListener('click', async () => {
          const ok = await confirmBox('Delete this record?', `"${row[result.columns[0].id] || 'This record'}" will be removed from your ${result.collection}. This can't be undone.`, 'Delete');
          if (ok && opts.onDelete) await opts.onDelete(row);
        });
        const td = el('td');
        td.append(del);
        tr.append(td);
      }
      table.tBodies[0].append(tr);
    }
    scroller.append(table);
    box.append(scroller);
    box.append(downloadLink('Download as spreadsheet (.csv)', `${result.collection || 'result'}.csv`, toCsv(result.columns, result.fullRows || result.rows), 'text/csv'));
    return box;
  }

  if (result.kind === 'file') {
    box.append(el('p', null, `Your file "${result.name}" is ready.`));
    box.append(downloadLink(`Download ${result.name}`, result.name, result.text, result.mime || 'text/plain'));
    const preview = el('pre', 'result-text');
    preview.textContent = result.text.slice(0, 5000);
    box.append(preview);
    return box;
  }

  const text = renderMarkdown(result.text);
  const copy = el('button', 'secondary', 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(result.text);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed: select the text instead';
    }
  });
  box.append(text, copy);
  return box;
}

function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'result.txt';
}

function downloadLink(label, name, text, mime) {
  const a = el('a', 'button', label);
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = safeFileName(name);
  return a;
}
