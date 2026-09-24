/**
 * Inline SVG icons (no external requests).
 * Shapes derived from Feather Icons — MIT License, https://feathericons.com
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

type Shape =
  | ['path', string]
  | ['circle', number, number, number]
  | ['line', number, number, number, number]
  | ['polyline', string]
  | ['polygon', string]
  | ['rect', number, number, number, number, number?];

const ICONS = {
  bluetooth: [['polyline', '6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5']],
  serial: [
    ['polyline', '4 17 10 11 4 5'],
    ['line', 12, 19, 20, 19],
  ],
  mail: [
    ['path', 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z'],
    ['polyline', '22,6 12,13 2,6'],
  ],
  phone: [
    [
      'path',
      'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
    ],
  ],
  facebook: [['path', 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z']],
  linkedin: [
    ['path', 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z'],
    ['rect', 2, 9, 4, 12],
    ['circle', 4, 4, 2],
  ],
  instagram: [
    ['rect', 2, 2, 20, 20, 5],
    ['path', 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z'],
    ['line', 17.5, 6.5, 17.51, 6.5],
  ],
  youtube: [
    [
      'path',
      'M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z',
    ],
    ['polygon', '9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02'],
  ],
  globe: [
    ['circle', 12, 12, 10],
    ['line', 2, 12, 22, 12],
    ['path', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'],
  ],
  download: [
    ['path', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'],
    ['polyline', '7 10 12 15 17 10'],
    ['line', 12, 15, 12, 3],
  ],
  trash: [
    ['polyline', '3 6 5 6 21 6'],
    ['path', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  ],
  send: [
    ['line', 22, 2, 11, 13],
    ['polygon', '22 2 15 22 11 13 2 9 22 2'],
  ],
  plug: [
    ['path', 'M18.36 6.64a9 9 0 1 1-12.73 0'],
    ['line', 12, 2, 12, 12],
  ],
  alert: [
    ['circle', 12, 12, 10],
    ['line', 12, 8, 12, 12],
    ['line', 12, 16, 12.01, 16],
  ],
  shield: [['path', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z']],
  lang: [
    ['circle', 12, 12, 10],
    ['line', 2, 12, 22, 12],
    ['path', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'],
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon icon-${name}`);
  for (const shape of ICONS[name] as Shape[]) {
    const el = document.createElementNS(SVG_NS, shape[0]);
    switch (shape[0]) {
      case 'path':
        el.setAttribute('d', shape[1]);
        break;
      case 'circle':
        el.setAttribute('cx', String(shape[1]));
        el.setAttribute('cy', String(shape[2]));
        el.setAttribute('r', String(shape[3]));
        break;
      case 'line':
        el.setAttribute('x1', String(shape[1]));
        el.setAttribute('y1', String(shape[2]));
        el.setAttribute('x2', String(shape[3]));
        el.setAttribute('y2', String(shape[4]));
        break;
      case 'polyline':
      case 'polygon':
        el.setAttribute('points', shape[1]);
        break;
      case 'rect':
        el.setAttribute('x', String(shape[1]));
        el.setAttribute('y', String(shape[2]));
        el.setAttribute('width', String(shape[3]));
        el.setAttribute('height', String(shape[4]));
        if (shape[5]) {
          el.setAttribute('rx', String(shape[5]));
          el.setAttribute('ry', String(shape[5]));
        }
        break;
    }
    svg.appendChild(el);
  }
  return svg;
}
