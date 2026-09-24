/**
 * Tiny DOM helpers. Content is always set through textContent /
 * setAttribute (never innerHTML), so device data can never inject markup.
 */
export type Child = Node | string | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, ...children);
  return el;
}

export function setAttrs(el: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') el.setAttribute('class', String(value));
    else el.setAttribute(name, value === true ? '' : String(value));
  }
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let uid = 0;
/** Unique id for label/input associations. */
export function nextId(prefix: string): string {
  uid++;
  return `${prefix}-${uid}`;
}

/** Builds a `<select>` from values. Labels are set later by the caller. */
export function select<T extends string | number>(
  values: readonly T[],
  current: T,
  attrs: Attrs = {},
): HTMLSelectElement {
  const s = h('select', attrs);
  for (const v of values) {
    const o = h('option', { value: String(v) }, String(v));
    if (v === current) o.selected = true;
    s.appendChild(o);
  }
  return s;
}
