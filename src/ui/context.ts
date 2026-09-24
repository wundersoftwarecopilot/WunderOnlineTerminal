import type { I18n } from '../i18n/i18n';
import type { SettingsStore } from '../settings/settings';
import type { TerminalLog } from '../terminal/log';
import type { TerminalSession } from '../terminal/session';
import type { BluetoothTransport } from '../transport/ble/BluetoothTransport';
import type { SerialTransport } from '../transport/serial/SerialTransport';
import type { Transport, TransportKind } from '../transport/types';

/** Shared services passed to every UI component. */
export interface AppContext {
  i18n: I18n;
  settings: SettingsStore;
  log: TerminalLog;
  session: TerminalSession;
  ble: BluetoothTransport;
  serial: SerialTransport;
}

export function transportOf(ctx: AppContext, kind: TransportKind): Transport {
  return kind === 'ble' ? ctx.ble : ctx.serial;
}

export function activeTransport(ctx: AppContext): Transport {
  return transportOf(ctx, ctx.settings.value.mode);
}
