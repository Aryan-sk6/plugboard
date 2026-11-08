// Plugboard screens. Plugin text and AI recipes are untrusted: only ever set with textContent, never as HTML.
const app = document.getElementById('app');

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

async function getJson(url) {
  let res;
  try {
    res = await fetch(url);
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

function renderList(items) {
  app.replaceChildren();
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
// STUB (M3): shows what the screen will contain. M3 replaces this with the real form components.

const TYPE_NAMES = { text: 'Short text', longtext: 'Long text', number: 'Number', date: 'Date', dropdown: 'Choice list', checkbox: 'Tick box', file: 'File', table: 'Table' };

function renderRecipe(data) {
  const { recipe, source, notice } = data;
  app.replaceChildren();
  const back = el('a', 'back', '← All helpers');
  back.href = '#';
  app.append(back, el('h2', 'tool-title', recipe.title), el('p', 'lede', recipe.summary));
  if (notice) app.append(el('p', 'notice', notice));
  for (const screen of recipe.screens) {
    const box = el('section', 'panel');
    box.append(el('h3', null, screen.title));
    if (screen.intro) box.append(el('p', 'desc', screen.intro));
    const fields = el('ul', 'fields');
    for (const f of screen.fields) {
      const li = el('li');
      li.append(el('strong', null, f.label), el('span', 'muted', ` · ${TYPE_NAMES[f.type] || f.type}${f.required ? ' · needed' : ''}`));
      if (f.type === 'dropdown' && f.options) li.append(el('div', 'muted small', 'Choices: ' + f.options.join(', ')));
      if (f.type === 'table' && f.columns) li.append(el('div', 'muted small', 'Columns: ' + f.columns.map((c) => c.label).join(', ')));
      fields.append(li);
    }
    box.append(fields);
    for (const a of screen.actions) {
      const row = el('div', 'action');
      const btn = el('button', null, a.label);
      btn.disabled = true;
      btn.title = 'Running helpers comes in a later version';
      row.append(btn, el('span', 'muted', a.does));
      box.append(row);
    }
    app.append(box);
  }
  app.append(el('p', 'muted small', source === 'cache' ? 'Screen loaded from this computer.' : source === 'generated' ? 'Screen designed just now and saved for next time.' : 'Simple screen shown.'));
}

async function openTool(id) {
  app.replaceChildren(el('p', 'status', 'Getting this helper ready… The first time can take a minute or two. After that it opens instantly.'));
  try {
    renderRecipe(await getJson('/api/recipe?id=' + encodeURIComponent(id)));
  } catch (err) {
    showError(err.message);
  }
}

async function route() {
  const m = /^#tool=(.+)$/.exec(location.hash);
  window.scrollTo(0, 0);
  if (m) return openTool(decodeURIComponent(m[1]));
  app.replaceChildren(el('p', 'status', 'Looking for your AI helpers…'));
  try {
    renderList((await getJson('/api/plugins')).items);
  } catch (err) {
    showError(err.message);
  }
}

window.addEventListener('hashchange', route);
route();
