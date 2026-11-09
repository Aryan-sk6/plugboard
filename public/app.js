import { renderRecipe, renderResult } from './renderer.js';

// Plugboard screens. Plugin text and AI recipes are untrusted: only ever set with textContent, never as HTML.
const app = document.getElementById('app');
let aiLabel = 'Claude'; // name of the AI helpers run through; updated from the server

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// "mkt-copy-editing" -> "Mkt copy editing"
function friendly(name) {
  const s = name.replace(/^.*:/, '').replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function getJson(url, body) {
  let res;
  try {
    res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Plugboard isn't responding. Make sure it is still running, then refresh this page.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function showError(message) {
  app.replaceChildren(el('p', 'status error', message));
}

// ---- List screen ----

function renderList(items, connected) {
  app.replaceChildren();
  if (!connected) {
    const banner = el('div', 'notice banner');
    const link = el('a', 'button', 'Connect your AI');
    link.href = '#setup';
    banner.append(el('span', null, `Connect your ${aiLabel} account to start using these helpers.`), link);
    app.append(banner);
  }
  if (items.length === 0) {
    const box = el('div', 'empty');
    box.append(
      el('h2', null, "We didn't find any AI helpers on this computer yet."),
      el('p', null, 'Plugboard shows the skills and plugins you have added to Claude. Add one in Claude, then refresh this page.'),
    );
    app.append(box);
    return;
  }
  app.append(el('p', 'count', `${items.length} helper${items.length === 1 ? '' : 's'} found`));
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.source)) groups.set(item.source, []);
    groups.get(item.source).push(item);
  }
  for (const [source, list] of groups) {
    const section = el('section');
    section.append(el('h2', null, source));
    const grid = el('ul', 'grid');
    for (const item of list) {
      const li = el('li');
      const card = el('a', 'card');
      card.href = '#tool=' + encodeURIComponent(item.id);
      card.append(
        el('span', 'tag', item.kind === 'skill' ? 'Skill' : 'Command'),
        el('h3', null, friendly(item.name)),
        el('p', 'desc', item.description || 'No description yet.'),
      );
      li.append(card);
      grid.append(li);
    }
    section.append(grid);
    app.append(section);
  }
}

// ---- Helper screen ----

/** Sends one button press to the Runner and shows live progress, then the result. */
async function runHelper(item, screen, action, values, results, form) {
  const stop = new AbortController();
  const box = el('section', 'panel result');
  box.setAttribute('aria-live', 'polite');
  const kind = action.kind || 'run';
  const status = el('p', 'status', kind === 'save' ? 'Saving…' : kind === 'list' ? 'Loading…' : `${aiLabel} is working on it… This can take a minute.`);
  const live = el('div', 'result-text');
  const stopBtn = el('button', 'secondary', 'Stop');
  stopBtn.type = 'button';
  stopBtn.addEventListener('click', () => stop.abort());
  box.append(el('h3', null, 'Working…'), status, live, stopBtn);
  results.replaceChildren(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  let result = null;
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, screenId: screen.id, actionId: action.id, values }),
      signal: stop.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Something went wrong. Please try again.');
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        const msg = JSON.parse(l);
        if (msg.type === 'progress') {
          if (msg.text) live.textContent += msg.text; // shown as plain text only
          if (msg.chars) status.textContent = `${aiLabel} is writing… (${msg.chars.toLocaleString()} characters so far)`;
        }
        if (msg.type === 'result') result = msg.result;
      }
    }
    if (!result) throw new Error('The answer was cut off. Please try again.');
  } catch (err) {
    result = { kind: 'error', text: stop.signal.aborted ? 'Stopped. Nothing else was done.' : err.message === 'Failed to fetch' ? "Plugboard isn't responding. Make sure it is still running, then try again." : err.message };
  }
  const onDelete = async (row) => {
    try {
      await getJson('/api/records/delete', { id: item.id, collection: result.collection, recordId: Number(row._id) });
    } catch (err) {
      results.replaceChildren(renderResult({ kind: 'error', text: err.message }));
      return;
    }
    form.refreshRecords();
    runHelper(item, screen, action, values, results, form); // show the updated list
  };
  results.replaceChildren(renderResult(result, { onDelete }));
}

function showTool(data) {
  const { item, recipe, source, notice } = data;
  app.replaceChildren();
  const back = el('a', 'back', '← All helpers');
  back.href = '#';
  app.append(back, el('h2', 'tool-title', recipe.title), el('p', 'lede', recipe.summary));
  if (notice) app.append(el('p', 'notice', notice));
  const results = el('div');
  const loadRecords = async (collection) => (await getJson(`/api/records?id=${encodeURIComponent(item.id)}&collection=${encodeURIComponent(collection)}`)).records;
  const form = renderRecipe(recipe, (screen, action, values) => runHelper(item, screen, action, values, results, form), { loadRecords });
  app.append(
    form,
    results,
    el('p', 'muted small', source === 'cache' ? 'Screen loaded from this computer.' : source === 'generated' ? 'Screen designed just now and saved for next time.' : 'Simple screen shown.'),
  );
}

async function openTool(id) {
  app.replaceChildren(el('p', 'status', 'Getting this helper ready… The first time can take a minute or two. After that it opens instantly.'));
  try {
    showTool(await getJson('/api/recipe?id=' + encodeURIComponent(id)));
  } catch (err) {
    showError(err.message);
  }
}

// ---- Connect your AI screen ----

let pollTimer = null;
let lastShown = '';

function step(title, ...children) {
  const box = el('section', 'panel');
  box.append(el('h3', null, title), ...children);
  return box;
}

function actionButton(label, onClick) {
  const b = el('button', null, label);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await onClick();
    } catch (err) {
      showSetup({ error: err.message });
    }
    b.disabled = false;
  });
  return b;
}

function renderSetup(s, returnTo) {
  // Re-render only when something changed, so typing in the code box isn't interrupted.
  const key = JSON.stringify(s);
  if (key === lastShown) return;
  lastShown = key;
  const L = s.provider.label;
  app.replaceChildren();
  const back = el('a', 'back', '← All helpers');
  back.href = '#';
  // Which AI to use. Picking one saves the choice, so helpers run through it from now on.
  const picker = el('div', 'tabs');
  picker.setAttribute('role', 'radiogroup');
  picker.setAttribute('aria-label', 'Which AI do you want to use?');
  for (const c of s.choices) {
    const b = el('button', 'tab', c.label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c.id === s.current));
    b.addEventListener('click', async () => {
      try {
        await getJson('/api/settings', { provider: c.id });
      } catch (err) {
        return showSetup({ error: err.message });
      }
      lastShown = '';
      poll(returnTo);
    });
    picker.append(b);
  }
  app.append(back, el('h2', 'tool-title', 'Connect your AI'), el('p', 'muted', 'Which AI do you want to use?'), picker,
    el('p', 'lede', `Plugboard uses your own ${L} account to do the work. You need ${s.provider.plan}. Your sign-in stays with ${L}; Plugboard never sees your password.`));
  if (s.provider.notice) app.append(el('p', 'notice', s.provider.notice));
  if (s.error) app.append(el('p', 'status error', s.error));

  if (s.installed && s.signedIn) {
    const go = el('a', 'button', 'Continue');
    go.href = returnTo || '#';
    app.append(step(`✓ ${L} is connected`, el('p', 'muted', 'You are ready to use your helpers.'), go));
    return;
  }

  if (!s.installed) {
    const parts = [];
    if (!s.provider.canInstall) {
      // Plugboard has no installer for this one: explain, link, and keep checking by itself.
      const link = el('a', null, s.provider.installHelp.url);
      link.href = s.provider.installHelp.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const p = el('p', 'muted', 'Instructions: ');
      p.append(link);
      parts.push(el('p', null, s.provider.installHelp.text), p, el('p', 'status', `Waiting for ${L} to be installed…`));
    } else if (s.install.state === 'running') {
      parts.push(el('p', 'status', `Installing ${L}… This usually takes a minute or two. Keep this page open.`));
    } else {
      parts.push(el('p', 'muted', `${L} is not on this computer yet. Plugboard can download the official program for you.`));
      if (s.install.state === 'failed') parts.push(el('p', 'status error', s.install.message));
      parts.push(actionButton(s.install.state === 'failed' ? 'Try again' : `Install ${L}`, () => getJson('/api/setup/install', {}).then(() => poll(returnTo))));
    }
    app.append(step(`Step 1: Install ${L}`, ...parts));
    return;
  }

  const parts = [];
  if (s.signin.state === 'running') {
    parts.push(el('p', null, `A ${L} sign-in page should have opened in your browser. Sign in there, then come back to this page.`));
    if (s.signin.url) {
      const link = el('a', null, 'Open the sign-in page');
      link.href = s.signin.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const p = el('p', 'muted', "Didn't open? ");
      p.append(link);
      parts.push(p);
    }
    if (s.signin.needsCode) {
      const input = el('input');
      input.type = 'text';
      input.id = 'code';
      input.autocomplete = 'off';
      const label = el('label', null, 'If the sign-in page shows a code, paste it here:');
      label.htmlFor = 'code';
      const row = el('div', 'action');
      row.append(input, actionButton('Send code', async () => {
        await getJson('/api/setup/code', { code: input.value });
        input.value = '';
      }));
      parts.push(label, row);
    }
    parts.push(el('p', 'status', 'Waiting for you to finish signing in…'));
  } else {
    parts.push(el('p', 'muted', `${L} is installed. Now sign in with your ${L} account.`));
    if (s.signin.state === 'failed') parts.push(el('p', 'status error', s.signin.message));
    parts.push(actionButton(`Sign in to ${L}`, () => getJson('/api/setup/signin', {}).then(() => poll(returnTo))));
  }
  app.append(step(`✓ ${L} is installed`), step('Step 2: Sign in', ...parts));
}

let showSetup = () => {};

async function poll(returnTo) {
  clearTimeout(pollTimer);
  if (!/^#(setup|tool=)/.test(location.hash)) return;
  try {
    const s = await getJson('/api/setup/status');
    aiLabel = s.provider.label;
    showSetup = (extra) => renderSetup({ ...s, ...extra }, returnTo);
    renderSetup(s, returnTo);
    if (s.installed && s.signedIn) return;
  } catch (err) {
    showError(err.message);
  }
  pollTimer = setTimeout(() => poll(returnTo), 2000);
}

async function route() {
  clearTimeout(pollTimer);
  lastShown = '';
  window.scrollTo(0, 0);
  const m = /^#tool=(.+)$/.exec(location.hash);
  if (location.hash === '#setup') return poll('#');
  app.replaceChildren(el('p', 'status', m ? 'Checking your AI…' : 'Looking for your AI helpers…'));
  try {
    const status = await getJson('/api/setup/status');
    aiLabel = status.provider.label;
    const connected = status.installed && status.signedIn;
    if (m) return connected ? openTool(decodeURIComponent(m[1])) : poll(location.hash);
    renderList((await getJson('/api/plugins')).items, connected);
    const { dataDir } = await getJson('/api/info').catch(() => ({}));
    if (dataDir) {
      const note = el('p', 'muted small footer-note', `Your saved records are kept on this computer in: ${dataDir}. Back up this folder to keep them safe. Helpers are run by ${aiLabel}. `);
      const change = el('a', null, 'Change');
      change.href = '#setup';
      note.append(change);
      app.append(note);
    }
  } catch (err) {
    showError(err.message);
  }
}

window.addEventListener('hashchange', route);
route();
