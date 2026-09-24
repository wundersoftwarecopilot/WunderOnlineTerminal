/**
 * Browser-side mocks of Web Bluetooth and Web Serial, injected with
 * `page.addInitScript(installWebApiMocks, options)`.
 *
 * The function must be self-contained (it is serialized into the page).
 * It simulates a generic BLE peripheral and a generic serial port; no
 * real device or protocol is involved.
 */
export interface MockOptions {
  /** 'mock' installs the mock, 'none' removes the API, 'native' leaves it. */
  ble: 'mock' | 'none' | 'native';
  serial: 'mock' | 'none' | 'native';
}

export function installWebApiMocks(options: MockOptions): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const w = window as any;
  const state: any = {
    requests: [] as any[],
    bleWrites: [] as number[][],
    serialWritten: [] as number[][],
    openOptions: null as any,
  };
  w.__mock = state;

  const define = (name: string, value: unknown): void => {
    Object.defineProperty(Navigator.prototype, name, { configurable: true, get: () => value });
  };
  const domError = (name: string, message = name) => new DOMException(message, name);

  if (options.ble === 'none') define('bluetooth', undefined);
  if (options.serial === 'none') define('serial', undefined);

  if (options.ble === 'mock') {
    const base = (a: number) => a.toString(16).padStart(8, '0') + '-0000-1000-8000-00805f9b34fb';
    const allProps = {
      broadcast: false,
      read: false,
      writeWithoutResponse: false,
      write: false,
      notify: false,
      indicate: false,
      authenticatedSignedWrites: false,
      reliableWrite: false,
      writableAuxiliaries: false,
    };
    let connected = false;

    class Char extends EventTarget {
      value: DataView | null = null;
      notifying = false;
      constructor(
        public uuid: string,
        public properties: any,
        public readImpl?: () => number[],
      ) {
        super();
      }
      async readValue() {
        if (!connected) throw domError('NetworkError');
        const v = new DataView(Uint8Array.from(this.readImpl ? this.readImpl() : []).buffer);
        this.value = v;
        this.dispatchEvent(new Event('characteristicvaluechanged'));
        return v;
      }
      async writeValueWithResponse(v: BufferSource) {
        const u = ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(v);
        state.bleWrites.push(Array.from(u));
      }
      async writeValueWithoutResponse(v: BufferSource) {
        return this.writeValueWithResponse(v);
      }
      async startNotifications() {
        this.notifying = true;
        return this;
      }
      async stopNotifications() {
        this.notifying = false;
        return this;
      }
      emit(bytes: number[]) {
        if (!this.notifying) return;
        this.value = new DataView(Uint8Array.from(bytes).buffer);
        this.dispatchEvent(new Event('characteristicvaluechanged'));
      }
    }

    const level = new Char(base(0x2a19), { ...allProps, read: true, notify: true }, () => [87]);
    const rx = new Char('0000abc1-1111-4000-8000-000000000001', { ...allProps, write: true, writeWithoutResponse: true });
    const tx = new Char('0000abc2-1111-4000-8000-000000000001', { ...allProps, notify: true });
    const services = [
      { uuid: base(0x180f), getCharacteristics: async () => [level] },
      { uuid: '0000abc0-1111-4000-8000-000000000001', getCharacteristics: async () => [rx, tx] },
    ];

    class Device extends EventTarget {
      id = 'mock-device';
      name = 'Mock Peripheral';
      gatt = {
        get connected() {
          return connected;
        },
        connect: async () => {
          connected = true;
          return this.gatt;
        },
        disconnect: () => {
          if (!connected) return;
          connected = false;
          [level, rx, tx].forEach((c) => (c.notifying = false));
          this.dispatchEvent(new Event('gattserverdisconnected'));
        },
        getPrimaryServices: async () => services,
      };
    }
    const device = new Device();

    define('bluetooth', {
      getAvailability: async () => true,
      requestDevice: async (opts: any) => {
        state.requests.push(JSON.parse(JSON.stringify(opts)));
        if (state.cancelNext) {
          state.cancelNext = false;
          throw domError('NotFoundError', 'User cancelled the requestDevice() chooser.');
        }
        return device;
      },
    });
    state.ble = {
      notify: (text: string) => tx.emit(Array.from(new TextEncoder().encode(text))),
      notifyBytes: (bytes: number[]) => tx.emit(bytes),
      lose: () => device.gatt.disconnect(),
    };
  }

  if (options.serial === 'mock') {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    class Port extends EventTarget {
      readable: ReadableStream<Uint8Array> | null = null;
      writable: WritableStream<Uint8Array> | null = null;
      getInfo() {
        return { usbVendorId: 0x0403, usbProductId: 0x6001 };
      }
      async open(o: any) {
        state.openOptions = o;
        this.readable = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
        this.writable = new WritableStream<Uint8Array>({
          write: (chunk) => void state.serialWritten.push(Array.from(chunk)),
        });
      }
      async close() {
        this.readable = null;
        this.writable = null;
      }
    }
    const port = new Port();
    define('serial', {
      requestPort: async () => port,
      getPorts: async () => [port],
    });
    state.serial = {
      receive: (text: string) => controller?.enqueue(new TextEncoder().encode(text)),
      receiveBytes: (bytes: number[]) => controller?.enqueue(Uint8Array.from(bytes)),
      unplug: () => {
        const c = controller;
        controller = undefined;
        c?.error(domError('NetworkError', 'The device has been lost.'));
        port.readable = null;
        port.writable = null;
        port.dispatchEvent(new Event('disconnect'));
      },
    };
  }
}
