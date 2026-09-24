import { bytesToHex, decodeForDisplay, type DisplaySegment } from '../core/bytes';
import { downloadTextFile } from '../export/download';
import { exportFilename, exportMimeType, toCsv, toTxt, type ExportFormat } from '../export/exporters';
import { bindText } from '../i18n/dom';
import type { ViewMode } from '../settings/settings';
import type { LogEntry } from '../terminal/log';
import {
  channelLabel,
  directionLabel,
  entryMessage,
  formatTime,
  transportLabel,
  type Translate,
} from '../terminal/format';
import type { AppContext } from './context';
import { clear, h } from './dom';
import { segmented } from './form';
import { icon } from './icons';

/** Maximum number of rows kept in the DOM (the log itself keeps more). */
export const MAX_DOM_ROWS = 2000;

function segmentsNode(segments: DisplaySegment[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const s of segments) {
    if (s.kind === 'text') frag.appendChild(document.createTextNode(s.value));
    else frag.appendChild(h('span', { class: s.kind === 'control' ? 'ctl' : 'bad' }, s.value));
  }
  return frag;
}

/** Renders one log entry as a terminal row. */
export function renderRow(entry: LogEntry, view: ViewMode, t: Translate): HTMLElement {
  const row = h('div', {
    class: `row row-${entry.direction}`,
    'data-dir': entry.direction,
    'data-transport': entry.transport ?? '',
  });
  row.append(
    h('span', { class: 'c-time' }, formatTime(entry.time)),
    h('span', { class: 'c-tport' }, transportLabel(entry, t)),
    h('span', { class: 'c-dir' }, directionLabel(entry, t)),
  );
  const payload = h('span', { class: 'c-data' });
  const channel = channelLabel(entry, t);
  if (channel) payload.appendChild(h('span', { class: 'c-chan' }, channel));

  if (entry.data) {
    if (view === 'hex') {
      payload.appendChild(h('span', { class: 'hex' }, bytesToHex(entry.data)));
    } else if (view === 'text') {
      payload.appendChild(h('span', { class: 'txt' }, segmentsNode(decodeForDisplay(entry.data))));
    } else {
      payload.append(
        h('span', { class: 'hex' }, bytesToHex(entry.data)),
        h('span', { class: 'txt' }, segmentsNode(decodeForDisplay(entry.data))),
      );
    }
  } else {
    payload.appendChild(h('span', { class: 'msg' }, entryMessage(entry, t)));
  }
  row.appendChild(payload);
  return row;
}

/** Terminal card: toolbar, output and statistics. */
export function createTerminalView(ctx: AppContext): HTMLElement {
  const { i18n, log, settings } = ctx;
  const t: Translate = (key, params) => i18n.t(key, params);

  const title = h('h2', { class: 'card-title' });
  bindText(title, i18n, 'term.title');

  const view = segmented<ViewMode>(
    i18n,
    'term.view',
    [
      { value: 'text', key: 'view.text' },
      { value: 'hex', key: 'view.hex' },
      { value: 'mixed', key: 'view.mixed' },
    ],
    settings.value.view,
    (value) => settings.update({ view: value }),
    'view-mode',
  );

  const autoScrollInput = h('input', { type: 'checkbox', 'data-testid': 'autoscroll' });
  autoScrollInput.checked = settings.value.autoScroll;
  const autoScrollText = h('span', {});
  bindText(autoScrollText, i18n, 'term.autoScroll');
  const autoScroll = h('label', { class: 'check check-toggle' }, autoScrollInput, autoScrollText);
  autoScrollInput.addEventListener('change', () =>
    settings.update({ autoScroll: autoScrollInput.checked }),
  );

  const clearText = h('span', {});
  bindText(clearText, i18n, 'term.clear');
  const clearBtn = h(
    'button',
    { type: 'button', class: 'btn btn-small', 'data-testid': 'clear' },
    icon('trash', 14),
    clearText,
  );
  clearBtn.addEventListener('click', () => log.clear());

  const exportButton = (format: ExportFormat): HTMLButtonElement => {
    const text = h('span', {});
    bindText(text, i18n, format === 'txt' ? 'term.exportTxt' : 'term.exportCsv');
    const btn = h(
      'button',
      { type: 'button', class: 'btn btn-small', 'data-testid': `export-${format}` },
      icon('download', 14),
      text,
    );
    btn.addEventListener('click', () => {
      ctx.session.flush();
      if (log.size === 0) {
        ctx.session.info(undefined, 'export.empty');
        return;
      }
      const content = format === 'txt' ? toTxt(log.entries, t) : toCsv(log.entries, t);
      downloadTextFile(exportFilename(format), content, exportMimeType(format));
    });
    return btn;
  };

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    view.el,
    autoScroll,
    h('div', { class: 'toolbar-spacer' }),
    clearBtn,
    exportButton('txt'),
    exportButton('csv'),
  );

  const output = h('div', {
    class: 'term-output',
    role: 'log',
    'aria-live': 'off',
    tabindex: 0,
    'data-testid': 'terminal',
  });
  bindText(output, i18n, 'term.logLabel', {}, 'aria-label');
  const empty = h('p', { class: 'term-empty' });
  bindText(empty, i18n, 'term.empty');

  const stats = h('span', { class: 'term-stats mono', 'data-testid': 'stats' });
  const truncated = h('span', { class: 'term-truncated', hidden: true });

  const card = h(
    'section',
    { class: 'card card-terminal' },
    h('header', { class: 'card-header' }, title),
    toolbar,
    output,
    h('footer', { class: 'term-footer' }, stats, truncated),
  );

  let pending: LogEntry[] = [];
  let scheduled = false;
  let rowCount = 0;

  const updateFooter = (): void => {
    const s = log.stats;
    bindText(stats, i18n, 'term.stats', { rx: s.rxBytes, tx: s.txBytes });
    const shown = Math.min(rowCount, log.size);
    truncated.hidden = log.size <= shown;
    if (!truncated.hidden) bindText(truncated, i18n, 'term.truncated', { shown, total: log.size });
  };

  const scrollToEnd = (): void => {
    if (settings.value.autoScroll) output.scrollTop = output.scrollHeight;
  };

  const showEmptyState = (): void => {
    if (rowCount === 0 && !output.contains(empty)) output.appendChild(empty);
    else if (rowCount > 0 && output.contains(empty)) empty.remove();
  };

  const flush = (): void => {
    scheduled = false;
    const batch = pending.slice(-MAX_DOM_ROWS);
    pending = [];
    if (batch.length > 0) {
      const frag = document.createDocumentFragment();
      const mode = settings.value.view;
      for (const entry of batch) frag.appendChild(renderRow(entry, mode, t));
      output.appendChild(frag);
      rowCount += batch.length;
      while (rowCount > MAX_DOM_ROWS) {
        const first = output.querySelector('.row');
        if (!first) break;
        first.remove();
        rowCount--;
      }
    }
    showEmptyState();
    updateFooter();
    scrollToEnd();
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function' && !document.hidden) {
      requestAnimationFrame(flush);
    } else {
      setTimeout(flush, 16);
    }
  };

  /** Rebuilds all rows (view mode or language changed). */
  const rerender = (): void => {
    pending = [];
    scheduled = false;
    clear(output);
    rowCount = 0;
    pending = log.entries.slice(-MAX_DOM_ROWS);
    flush();
  };

  log.on('append', (entry) => {
    pending.push(entry);
    if (pending.length > MAX_DOM_ROWS * 2) pending = pending.slice(-MAX_DOM_ROWS);
    schedule();
  });
  log.on('clear', rerender);

  let lastView = settings.value.view;
  settings.onChange((s) => {
    view.set(s.view);
    autoScrollInput.checked = s.autoScroll;
    if (s.view !== lastView) {
      lastView = s.view;
      rerender();
    } else {
      scrollToEnd();
    }
  });
  i18n.onChange(rerender);

  rerender();
  return card;
}
