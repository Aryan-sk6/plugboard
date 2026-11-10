// The fixed menu of looks. The AI can only pick names from these lists; it never supplies colors, SVG or code.
// Plain browser JS, also imported by the server so the page and the screen checks share one list.

export const COLORS = ['teal', 'blue', 'violet', 'orange', 'rose', 'green', 'amber', 'slate'];

// Simple 24x24 outline icons. Each entry is a list of SVG shapes: [tag, attributes].
const p = (d) => ['path', { d }];
const c = (cx, cy, r) => ['circle', { cx, cy, r }];
const r = (x, y, width, height, rx) => ['rect', { x, y, width, height, rx }];

export const ICONS = {
  receipt: [p('M6 3h12v18l-3-2-3 2-3-2-3 2V3z'), p('M9 8h6M9 12h6')],
  box: [p('M3 7.5l9-4.5 9 4.5v9l-9 4.5-9-4.5z'), p('M3 7.5l9 4.5 9-4.5M12 12v9')],
  mail: [r(3, 5, 18, 14, 2), p('M3 7l9 6 9-6')],
  users: [c(9, 8, 3), p('M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6'), c(17, 9, 2.5), p('M17 14c2.2 0 4 1.8 4 4')],
  chart: [p('M4 20V10M10 20V4M16 20v-8M22 20H2')],
  calendar: [r(3, 5, 18, 16, 2), p('M3 10h18M8 3v4M16 3v4')],
  tag: [p('M3 12V4h8l10 10-8 8L3 12z'), c(7.5, 8.5, 1.2)],
  cart: [p('M3 4h2l2.4 11h10.2L20 8H6'), c(9, 19, 1.4), c(17, 19, 1.4)],
  clipboard: [r(6, 4, 12, 17, 2), p('M9 4V3h6v1M9 10h6M9 14h6')],
  megaphone: [p('M3 11v4l12 5V6L3 11z'), p('M15 9c2.5 0 4 1.3 4 3s-1.5 3-4 3'), p('M6 15l1 5h3')],
  wrench: [p('M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z')],
  book: [p('M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z'), p('M4 19a2 2 0 0 1 2-2h13')],
  heart: [p('M12 20s-8-4.7-8-10a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 10c0 5.3-8 10-8 10z')],
  star: [['polygon', { points: '12 3 14.8 9 21 9.7 16.3 14 17.7 20.5 12 17.2 6.3 20.5 7.7 14 3 9.7 9.2 9' }]],
  globe: [c(12, 12, 9), p('M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18')],
  file: [p('M6 3h8l4 4v14H6z'), p('M14 3v4h4M9 13h6M9 17h6')],
  sparkles: [p('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'), p('M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z')],
};

export const ICON_NAMES = Object.keys(ICONS);

/** Used by the app frame only (not offered to the AI). */
const EXTRA = { search: [c(11, 11, 7), p('M21 21l-4.3-4.3')], menu: [p('M4 6h16M4 12h16M4 18h16')], arrow: [p('M5 12h14M13 6l6 6-6 6')] };

/** Builds an SVG icon element shape by shape (no innerHTML). Unknown names get the sparkles icon. */
export function iconEl(name, size = 20) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name] || EXTRA[name] || ICONS.sparkles) {
    const shape = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
    svg.append(shape);
  }
  return svg;
}

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
}

/** A steady color and icon for a helper that has no look of its own yet: the same name always gives the same look. */
export function fallbackLook(name) {
  const h = hash(String(name).toLowerCase());
  return { color: COLORS[h % COLORS.length], icon: ICON_NAMES[(h >>> 8) % ICON_NAMES.length] };
}

/** The look to show: the AI's choice if it is on the menu, otherwise the steady fallback. */
export function lookFor(name, look) {
  const fb = fallbackLook(name);
  return { color: COLORS.includes(look?.color) ? look.color : fb.color, icon: ICON_NAMES.includes(look?.icon) ? look.icon : fb.icon };
}
