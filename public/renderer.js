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
  if (!TEXT_FILE.test(name)) return 'For now Maginary can read text files only, like .txt, .csv or .md.';
  if (size > MAX_FILE_BYTES) return `This file is too big. Please use a file under ${Math.round(MAX_FILE_BYTES / 1000)} KB.`;
  return null;
}

// ---------- layout and look helpers (pure, so they can be tested in Node) ----------

export const LAYOUTS = ['form', 'split', 'data', 'steps'];
export const SHOW_STYLES = ['plain', 'document', 'email'];

/** Groups a screen's fields into sections by their "section" heading. A field without one joins the section before it. */
export function sectionsOf(screen) {
  const out = [];
  for (const f of screen.fields) {
    const title = f.section ? String(f.section) : null;
    const last = out[out.length - 1];
    if (last && (title === null || title === last.title)) last.fields.push(f);
    else out.push({ title, fields: [f] });
  }
  return out;
}

/** The layout to use. One the screen can't support (no list for "data", under two sections for "steps") falls back to a plain form. */
export function layoutOf(screen) {
  const l = screen.layout;
  if (l === 'data' && !screen.actions.some((a) => (a.kind ?? 'run') === 'list')) return 'form';
  if (l === 'steps' && sectionsOf(screen).filter((s) => s.title).length < 2) return 'form';
  return LAYOUTS.includes(l) ? l : 'form';
}

/** How a button's result is shown. Anything unknown is plain. */
export function showOf(action) {
  return SHOW_STYLES.includes(action?.show) ? action.show : 'plain';
}

/**
 * Pulls "To:", "Subject:" and similar lines off the top of an email so they can be shown as a header.
 * A short line or two before them ("Here is your email:") is kept apart as a preface. Without any header lines,
 * the whole text is the body.
 */
export function parseEmail(text) {
  const whole = String(text).replace(/\r\n?/g, '\n').trim();
  const lines = whole.split('\n');
  const isHeader = (l) => /^(to|from|cc|bcc|subject):\s*\S/i.test(l);
  const start = lines.findIndex((l, i) => i < 6 && isHeader(l));
  if (start < 0) return { preface: '', headers: [], body: whole, email: whole };
  const headers = [];
  let i = start;
  for (; i < lines.length && isHeader(lines[i]); i++) {
    const m = /^([a-z]+):\s*(.*)$/i.exec(lines[i]);
    headers.push([m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), m[2].trim()]);
  }
  while (i < lines.length && !lines[i].trim()) i++;
  return { preface: lines.slice(0, start).join(' ').trim(), headers, body: lines.slice(i).join('\n').trim(), email: lines.slice(start).join('\n').trim() };
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
  const wrap = el('div', `field field-${f.type}${f.width === 'half' ? ' half' : ''}`);
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

/**
 * Only AI actions can need an "are you sure" box. Saving to, or listing, Maginary's own lists never
 * writes files or sends messages, whatever the (AI-written) flags on the recipe say.
 */
export function needsConfirm(action) {
  return (action.kind ?? 'run') === 'run' && Boolean(action.writesFiles || action.sendsMessages);
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
    if (action.writesFiles) list.append(el('li', null, 'This makes a file for you to download. Maginary does not change any files on your computer.'));
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

/** A button that copies text and says so. */
function copyButton(getText, label = 'Copy') {
  const copy = el('button', 'secondary', label);
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      copy.textContent = 'Copied ✓';
    } catch {
      copy.textContent = 'Copy failed: select the text instead';
    }
  });
  return copy;
}

/**
 * Renders a whole recipe. Each screen gets its own layout ("form", "split", "data" or "steps": see layoutOf),
 * its fields grouped into sections, and its own place for results.
 * onAction(screen, action, values, slots, meta) is called after the form checks out (and the user confirmed, if needed).
 *   slots = { results, toast }: where this screen shows results. toast only exists in the "data" layout, for "Saved" messages.
 *   meta.auto is true for the saved list that the "data" layout loads by itself.
 * opts.loadRecords(collection) returns [{ id, label }] for "pick a saved record" fields.
 */
export function renderRecipe(recipe, onAction, opts = {}) {
  const root = el('div', 'recipe');
  const screens = recipe.screens;
  let tabs = null;
  const panes = [];
  const reloaders = [];
  /** Refreshes every "pick a saved record" list, e.g. after something was saved or deleted. */
  root.refreshRecords = () => Promise.all(reloaders.map((r) => r()));

  if (screens.length > 1) {
    tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    root.append(tabs);
  }

  screens.forEach((screen, i) => {
    const layout = layoutOf(screen);
    const pane = el('div', `screen layout-${layout}`);
    const panel = el('form', 'panel');
    panel.noValidate = true;
    panel.addEventListener('submit', (e) => e.preventDefault());
    const head = el('div', 'panel-head');
    head.append(el('h3', null, screen.title));
    if (screen.intro) head.append(el('p', 'muted', screen.intro));
    panel.append(head);

    const fields = []; // { f, ui }
    const sections = sectionsOf(screen).map((s) => {
      const box = el('fieldset', 'section');
      if (s.title) box.append(el('legend', null, s.title));
      const grid = el('div', 'grid');
      for (const f of s.fields) {
        const ui = buildField(f, opts);
        if (ui.reload) reloaders.push(ui.reload);
        grid.append(ui.node);
        fields.push({ f, ui });
      }
      box.append(grid);
      panel.append(box);
      return { ...s, box };
    });

    const values = () => Object.fromEntries(fields.map(({ f, ui }) => [f.id, ui.get()]));
    /** Shows each field's problem (or clears it). Returns the first field with a problem. */
    const showErrors = (errors) => {
      let first = null;
      for (const item of fields) {
        item.ui.setError(errors[item.f.id] || null);
        if (errors[item.f.id] && !first) first = item;
      }
      return first;
    };

    const actionsRow = el('div', 'action actions');

    // "steps": one section at a time, with Back and Next. The buttons appear on the last step.
    let goTo = () => {};
    if (layout === 'steps') {
      const stepper = el('ol', 'stepper');
      sections.forEach((s, n) => {
        const li = el('li');
        li.append(el('span', 'num', String(n + 1)), el('span', 'name', s.title || `Step ${n + 1}`));
        stepper.append(li);
      });
      const back = el('button', 'secondary', 'Back');
      const next = el('button', null, 'Next');
      back.type = next.type = 'button';
      let current = 0;
      goTo = (n) => {
        current = Math.max(0, Math.min(sections.length - 1, n));
        sections.forEach((s, k) => (s.box.hidden = k !== current));
        [...stepper.children].forEach((li, k) => {
          li.classList.toggle('done', k < current);
          if (k === current) li.setAttribute('aria-current', 'step');
          else li.removeAttribute('aria-current');
        });
        back.hidden = current === 0;
        next.hidden = current === sections.length - 1;
        actionsRow.hidden = current !== sections.length - 1;
      };
      back.addEventListener('click', () => goTo(current - 1));
      next.addEventListener('click', () => {
        const first = showErrors(validateValues({ fields: sections[current].fields }, values()));
        if (first) return first.ui.focus();
        goTo(current + 1);
      });
      const nav = el('div', 'step-nav');
      nav.append(back, next);
      panel.insertBefore(stepper, sections[0].box);
      panel.append(nav);
    }

    const listAction = screen.actions.find((a) => (a.kind ?? 'run') === 'list');
    const slots = { results: el('div', 'results'), toast: layout === 'data' ? el('div', 'toast') : null };
    if (layout === 'split') slots.results.dataset.placeholder = 'Your result will appear here.';
    const runList = () => Promise.resolve(onAction(screen, listAction, {}, slots, { auto: true })).catch(() => {});

    for (const action of screen.actions) {
      const btn = el('button', null, action.label);
      btn.type = 'button';
      const desc = el('p', 'help', action.does);
      desc.id = `a${++uid}`;
      btn.setAttribute('aria-describedby', desc.id);
      btn.addEventListener('click', async () => {
        const vals = values();
        const errors = action.kind === 'list' ? {} : validateValues(screen, vals); // showing a list needs no answers
        const first = showErrors(errors);
        if (first) {
          if (layout === 'steps') goTo(sections.findIndex((s) => s.fields.includes(first.f)));
          return first.ui.focus();
        }
        btn.disabled = true; // also stops a second press from stacking a second "are you sure" box
        try {
          if (needsConfirm(action) && !(await confirmAction(action))) return;
          await onAction(screen, action, vals, slots, {});
        } finally {
          btn.disabled = false;
          if (action.kind === 'save' || action.saveTo) root.refreshRecords();
          if (layout === 'data' && listAction && action.kind === 'save') runList(); // keep the list on screen up to date
        }
      });
      const itemBox = el('div', 'action-item');
      itemBox.append(btn, desc);
      if (layout === 'data' && action === listAction) itemBox.hidden = true; // that list is always shown and refreshes itself
      actionsRow.append(itemBox);
    }
    panel.append(actionsRow);
    if (slots.toast) panel.append(slots.toast);
    if (layout === 'steps') goTo(0);

    const formPane = el('div', 'pane-form');
    formPane.append(panel);
    const resultPane = el('div', 'pane-result');
    resultPane.append(slots.results);
    if (layout === 'data' && screen.fields.length === 0) {
      // A saved list with nothing to fill in: no form card, just the title and the list across the page.
      pane.classList.add('list-only');
      resultPane.prepend(head);
      pane.append(resultPane);
    } else if (layout === 'data') pane.append(resultPane, formPane);
    else pane.append(formPane, resultPane);
    panes.push(pane);
    root.append(pane);
    if (layout === 'data' && listAction) setTimeout(runList, 0);

    if (tabs) {
      const tab = el('button', 'tab', screen.title);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => show(i));
      tabs.append(tab);
    }
  });

  function show(i) {
    panes.forEach((p, j) => (p.hidden = j !== i));
    if (tabs) [...tabs.children].forEach((t, j) => t.setAttribute('aria-selected', String(j === i)));
  }
  show(0);
  return root;
}

/** An email as a mail card: To/Subject on top, the message below. */
function emailCard(text) {
  const { preface, headers, body } = parseEmail(text);
  const wrap = el('div', 'mail-wrap');
  if (preface) wrap.append(el('p', 'muted', preface));
  const card = el('div', 'mail');
  if (headers.length) {
    const head = el('dl', 'mail-head');
    for (const [k, v] of headers) head.append(el('dt', null, k), el('dd', null, v));
    card.append(head);
  }
  card.append(renderMarkdown(body));
  wrap.append(card);
  return wrap;
}

/**
 * Result panel. result is one of:
 *   { kind: 'text', text }
 *   { kind: 'table', columns: [{ id, label }], rows: [{...}] }
 *   { kind: 'file', name, text, mime? }
 *   { kind: 'records', collection, columns, rows: [{ _id, ...}] }   saved records, with Delete buttons
 *   { kind: 'saved', text }
 *   { kind: 'error', text }
 * Any result may carry savedNote.
 * opts.show ("plain", "document" or "email") says how to show text. opts.onDelete(row) runs when a saved record's Delete is confirmed.
 */
export function renderResult(result, opts = {}) {
  const show = SHOW_STYLES.includes(opts.show) ? opts.show : 'plain';
  const box = el('section', `panel result result-${result.kind}`);
  box.setAttribute('aria-live', 'polite');
  const titles = { error: 'Something went wrong', saved: 'Saved', records: `Your saved ${result.collection || 'records'}` };
  box.append(el('h3', null, titles[result.kind] || 'Result'));

  if (result.kind === 'error') {
    box.classList.add('result-error');
    box.append(el('p', null, result.text));
    return box;
  }
  if (result.note) box.append(el('p', 'result-note', result.note));
  if (result.savedNote) box.append(el('p', 'notice', '✓ ' + result.savedNote));

  if (result.kind === 'saved') {
    box.append(el('p', 'saved-line', '✓ ' + result.text));
    return box;
  }

  if (result.kind === 'table' || result.kind === 'records') {
    if (result.rows.length === 0) {
      box.append(el('p', 'muted empty-note', 'Nothing saved here yet.'));
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
      for (const c of result.columns) {
        const v = row[c.id] == null ? '' : String(row[c.id]);
        const td = el('td', /^[-+]?[$€£₹]?\s?[\d,]+(\.\d+)?%?$/.test(v) ? 'num' : v.length <= 16 ? 'short' : null, v); // numbers line up on the right; short cells never break
        tr.append(td);
      }
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
    // A file is shown like a printed page, with its name and the download button on top.
    box.classList.add('result-document');
    const bar = el('div', 'toolbar');
    bar.append(el('span', 'chip', result.name), downloadLink(`Download ${result.name}`, result.name, result.text, result.mime || 'text/plain'), copyButton(() => result.text));
    const paper = el('div', 'paper');
    const pre = el('pre', 'paper-text');
    pre.textContent = result.text.slice(0, 20000);
    paper.append(pre);
    box.append(bar, paper);
    return box;
  }

  if (show === 'email') {
    box.classList.add('result-email');
    box.append(emailCard(result.text));
    box.append(copyButton(() => parseEmail(result.text).email, 'Copy email'));
    return box;
  }
  if (show === 'document') {
    box.classList.add('result-document');
    const paper = el('div', 'paper');
    paper.append(renderMarkdown(result.text));
    box.append(paper, copyButton(() => result.text));
    return box;
  }

  box.append(renderMarkdown(result.text), copyButton(() => result.text));
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
