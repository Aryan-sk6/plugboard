// List screen. Plugin text is untrusted: it is only ever set with textContent, never as HTML.
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

function render(items) {
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
      const card = el('li', 'card');
      card.append(
        el('span', 'tag', item.kind === 'skill' ? 'Skill' : 'Command'),
        el('h3', null, friendly(item.name)),
        el('p', 'desc', item.description || 'No description yet.'),
      );
      grid.append(card);
    }
    section.append(grid);
    app.append(section);
  }
}

async function load() {
  try {
    const res = await fetch('/api/plugins');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    render(data.items);
  } catch (err) {
    app.replaceChildren(el('p', 'status error', (err && err.message) || "Plugboard couldn't load your helpers. Make sure it is still running, then refresh this page."));
  }
}

load();
