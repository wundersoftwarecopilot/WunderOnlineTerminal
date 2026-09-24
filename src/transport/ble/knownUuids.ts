/**
 * Publicly documented, vendor-neutral Bluetooth UUIDs.
 *
 * IMPORTANT – why this list exists:
 * Web Bluetooth only exposes the GATT services that were declared in
 * `optionalServices` when the device was requested. Services that are not
 * declared are invisible to web pages. This file therefore lists:
 *
 * 1. the whole Bluetooth SIG 16-bit GATT service range (0x1800-0x18FF),
 *    i.e. official public standards from the Bluetooth Assigned Numbers;
 * 2. a few widely used, publicly documented "BLE serial" profiles that are
 *    implemented by many unrelated modules and vendors (optional, can be
 *    disabled in the settings).
 *
 * Any other service can be added by the user at runtime (settings field
 * "Additional service UUIDs"). Nothing here belongs to a specific product
 * or manufacturer protocol, and no handshake or command is ever sent.
 */
import { uuidFromAlias } from './uuid';

/** First and last 16-bit alias of the SIG GATT service range. */
export const SIG_SERVICE_RANGE = { first: 0x1800, last: 0x18ff } as const;

/** All 16-bit aliases of the SIG GATT service range. */
export function sigServiceAliases(): number[] {
  const out: number[] = [];
  for (let a = SIG_SERVICE_RANGE.first; a <= SIG_SERVICE_RANGE.last; a++) out.push(a);
  return out;
}

/** Display names for common SIG services (Bluetooth Assigned Numbers). */
const SIG_SERVICE_NAMES: Record<number, string> = {
  0x1800: 'Generic Access',
  0x1801: 'Generic Attribute',
  0x1802: 'Immediate Alert',
  0x1803: 'Link Loss',
  0x1804: 'Tx Power',
  0x1805: 'Current Time',
  0x1806: 'Reference Time Update',
  0x1807: 'Next DST Change',
  0x1808: 'Glucose',
  0x1809: 'Health Thermometer',
  0x180a: 'Device Information',
  0x180d: 'Heart Rate',
  0x180e: 'Phone Alert Status',
  0x180f: 'Battery',
  0x1810: 'Blood Pressure',
  0x1811: 'Alert Notification',
  0x1812: 'Human Interface Device',
  0x1813: 'Scan Parameters',
  0x1814: 'Running Speed and Cadence',
  0x1815: 'Automation IO',
  0x1816: 'Cycling Speed and Cadence',
  0x1818: 'Cycling Power',
  0x1819: 'Location and Navigation',
  0x181a: 'Environmental Sensing',
  0x181b: 'Body Composition',
  0x181c: 'User Data',
  0x181d: 'Weight Scale',
  0x181e: 'Bond Management',
  0x181f: 'Continuous Glucose Monitoring',
  0x1820: 'Internet Protocol Support',
  0x1821: 'Indoor Positioning',
  0x1822: 'Pulse Oximeter',
  0x1826: 'Fitness Machine',
};

/** Display names for common SIG characteristics (Bluetooth Assigned Numbers). */
const SIG_CHARACTERISTIC_NAMES: Record<number, string> = {
  0x2a00: 'Device Name',
  0x2a01: 'Appearance',
  0x2a02: 'Peripheral Privacy Flag',
  0x2a03: 'Reconnection Address',
  0x2a04: 'Peripheral Preferred Connection Parameters',
  0x2a05: 'Service Changed',
  0x2a06: 'Alert Level',
  0x2a07: 'Tx Power Level',
  0x2a08: 'Date Time',
  0x2a19: 'Battery Level',
  0x2a1c: 'Temperature Measurement',
  0x2a23: 'System ID',
  0x2a24: 'Model Number String',
  0x2a25: 'Serial Number String',
  0x2a26: 'Firmware Revision String',
  0x2a27: 'Hardware Revision String',
  0x2a28: 'Software Revision String',
  0x2a29: 'Manufacturer Name String',
  0x2a2b: 'Current Time',
  0x2a37: 'Heart Rate Measurement',
  0x2a38: 'Body Sensor Location',
  0x2a50: 'PnP ID',
  0x2a6d: 'Pressure',
  0x2a6e: 'Temperature',
  0x2a6f: 'Humidity',
  0x2aa6: 'Central Address Resolution',
  0x2b29: 'Client Supported Features',
  0x2b2a: 'Database Hash',
  0x2b3a: 'Server Supported Features',
};

interface NamedUuid {
  uuid: string;
  name: string;
}

/**
 * Generic "serial over BLE" profiles published by chip / module makers and
 * reused by countless unrelated products. They are only requested so that
 * the browser lets the page see them; they are never used automatically.
 */
export const COMMON_SERIAL_SERVICES: readonly NamedUuid[] = [
  // Nordic UART Service (Nordic Semiconductor, public nRF SDK documentation).
  { uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', name: 'Nordic UART Service' },
  // Microchip (ex ISSC) Transparent UART service.
  { uuid: '49535343-fe7d-4ae5-8fa9-9fafd205e455', name: 'Microchip Transparent UART' },
  // u-blox Serial Port Service.
  { uuid: '2456e1b9-26e2-8f83-e744-f34f01e9d701', name: 'u-blox Serial Port Service' },
  // Generic vendor-range services used by many low-cost serial modules.
  { uuid: uuidFromAlias(0xffe0), name: 'Generic serial module (FFE0)' },
  { uuid: uuidFromAlias(0xfff0), name: 'Generic vendor service (FFF0)' },
];

const COMMON_SERIAL_CHARACTERISTICS: readonly NamedUuid[] = [
  { uuid: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', name: 'UART RX' },
  { uuid: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', name: 'UART TX' },
  { uuid: '49535343-8841-43f4-a8d4-ecbe34729bb3', name: 'Transparent UART RX' },
  { uuid: '49535343-1e4d-4bd9-ba61-23c647249616', name: 'Transparent UART TX' },
  { uuid: '2456e1b9-26e2-8f83-e744-f34f01e9d703', name: 'SPS FIFO' },
  { uuid: '2456e1b9-26e2-8f83-e744-f34f01e9d704', name: 'SPS Credits' },
  { uuid: uuidFromAlias(0xffe1), name: 'Serial data (FFE1)' },
];

const SERVICE_NAMES = new Map<string, string>([
  ...Object.entries(SIG_SERVICE_NAMES).map(
    ([alias, name]) => [uuidFromAlias(Number(alias)), name] as [string, string],
  ),
  ...COMMON_SERIAL_SERVICES.map((s) => [s.uuid, s.name] as [string, string]),
]);

const CHARACTERISTIC_NAMES = new Map<string, string>([
  ...Object.entries(SIG_CHARACTERISTIC_NAMES).map(
    ([alias, name]) => [uuidFromAlias(Number(alias)), name] as [string, string],
  ),
  ...COMMON_SERIAL_CHARACTERISTICS.map((c) => [c.uuid, c.name] as [string, string]),
]);

export function serviceName(uuid: string): string | undefined {
  return SERVICE_NAMES.get(uuid.toLowerCase());
}

export function characteristicName(uuid: string): string | undefined {
  return CHARACTERISTIC_NAMES.get(uuid.toLowerCase());
}

/** SIG "infrastructure" services never auto-selected as a TX target. */
export const GENERIC_INFRASTRUCTURE_SERVICES: readonly string[] = [
  uuidFromAlias(0x1800),
  uuidFromAlias(0x1801),
];

export interface OptionalServicesConfig {
  includeCommonSerial: boolean;
  /** UUIDs typed by the user (already normalized). */
  extra: readonly string[];
}

/**
 * Builds the `optionalServices` list passed to `requestDevice()`.
 * Numbers are 16-bit SIG aliases, strings are full 128-bit UUIDs.
 */
export function buildOptionalServices(config: OptionalServicesConfig): Array<number | string> {
  const list: Array<number | string> = sigServiceAliases();
  const seen = new Set(list.map((a) => uuidFromAlias(a as number)));
  const add = (uuid: string): void => {
    const u = uuid.toLowerCase();
    if (!seen.has(u)) {
      seen.add(u);
      list.push(u);
    }
  };
  if (config.includeCommonSerial) COMMON_SERIAL_SERVICES.forEach((s) => add(s.uuid));
  config.extra.forEach(add);
  return list;
}
