/**
 * Web Bluetooth transport for the café's Rongta RPP02N (iWare branded).
 *
 * The printer exposes the ISSC/Microchip "transparent UART" service — a
 * plain serial pipe — so printing is just writing ESC/POS bytes to its
 * writable characteristic.
 *
 * Browser-only: import from client components. Android Chrome supports
 * this; iOS/Safari does not, which is why the POS device is an Android
 * tablet (see docs/cafe-erp-prd.md §6.11).
 *
 * Minimal Web Bluetooth types are declared locally rather than pulling in
 * @types/web-bluetooth for one module.
 */

/** ISSC transparent UART. The `49535343` prefix is ASCII for "ISSC". */
export const PRINTER_SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455";

/**
 * Other service UUIDs used by common ESC/POS BLE printers. Listed so a
 * different unit can still be discovered — Web Bluetooth only exposes
 * services named up front, so an unlisted one is invisible.
 */
export const FALLBACK_SERVICE_UUIDS = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];

type GattCharacteristic = {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean };
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<GattCharacteristic>;
  addEventListener(type: string, listener: (event: Event) => void): void;
};

type GattService = { uuid: string; getCharacteristics(): Promise<GattCharacteristic[]> };

type GattServer = {
  connected: boolean;
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryServices(uuid?: string): Promise<GattService[]>;
};

export type PrinterDevice = {
  id: string;
  name?: string;
  gatt?: GattServer;
  addEventListener(type: string, listener: (event: Event) => void): void;
};

type BluetoothApi = {
  requestDevice(options: {
    filters?: Array<{ namePrefix?: string; services?: string[] }>;
    acceptAllDevices?: boolean;
    optionalServices?: string[];
  }): Promise<PrinterDevice>;
  getDevices?(): Promise<PrinterDevice[]>;
};

export type PrinterLink = {
  device: PrinterDevice;
  serviceUuid: string;
  characteristicUuid: string;
  /** Writes with acknowledgement give back-pressure; without is faster but can overrun the buffer. */
  mode: "with-response" | "without-response";
  write(bytes: Uint8Array, options?: WriteOptions): Promise<void>;
  /** Printer status bytes, when the unit reports any. Not all clones do. */
  onNotify(listener: (bytes: Uint8Array) => void): Promise<boolean>;
  disconnect(): void;
};

export type WriteOptions = {
  /** BLE caps a single write at the negotiated MTU; 120 is safe on Android. */
  chunkSize?: number;
  /** Pause between chunks so the printer's small buffer can drain. */
  delayMs?: number;
  onProgress?: (sent: number, total: number) => void;
};

const WRITE_DEFAULTS = { chunkSize: 120, delayMs: 20 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getBluetooth(): BluetoothApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth ?? null;
}

export function isWebBluetoothAvailable(): boolean {
  return getBluetooth() !== null;
}

/** True when the browser can reopen an already-approved printer without a chooser. */
export function canRememberDevices(): boolean {
  return typeof getBluetooth()?.getDevices === "function";
}

/**
 * Shows the browser's device chooser. Requires a user gesture (a tap) and
 * a secure context — Web Bluetooth refuses to run over plain http://.
 */
export async function requestPrinter(acceptAllDevices = false): Promise<PrinterDevice> {
  const bluetooth = getBluetooth();
  if (!bluetooth) throw new Error("This browser has no Web Bluetooth. Use Chrome on Android.");
  const optionalServices = [PRINTER_SERVICE_UUID, ...FALLBACK_SERVICE_UUIDS];
  // The RPP02N may not advertise its service UUID, so match on name too.
  return acceptAllDevices
    ? bluetooth.requestDevice({ acceptAllDevices: true, optionalServices })
    : bluetooth.requestDevice({
        filters: [{ namePrefix: "RPP" }, { services: [PRINTER_SERVICE_UUID] }],
        optionalServices,
      });
}

/** Printers this browser has already been granted, for silent reconnects. */
export async function getRememberedPrinters(): Promise<PrinterDevice[]> {
  const bluetooth = getBluetooth();
  if (!bluetooth?.getDevices) return [];
  try {
    return await bluetooth.getDevices();
  } catch {
    return [];
  }
}

function pickWritable(characteristics: GattCharacteristic[]): GattCharacteristic | null {
  return (
    characteristics.find((c) => c.properties.write) ??
    characteristics.find((c) => c.properties.writeWithoutResponse) ??
    null
  );
}

/**
 * Connects and locates the writable characteristic by inspecting what the
 * printer actually exposes, rather than hardcoding a UUID that varies
 * between production runs of these clone printers.
 */
export async function openPrinter(device: PrinterDevice): Promise<PrinterLink> {
  if (!device.gatt) throw new Error("This device exposes no GATT server.");
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();

  let services: GattService[] = [];
  try {
    services = await server.getPrimaryServices(PRINTER_SERVICE_UUID);
  } catch {
    services = [];
  }
  if (!services.length) services = await server.getPrimaryServices();

  let service: GattService | null = null;
  let characteristic: GattCharacteristic | null = null;
  let notifyCharacteristic: GattCharacteristic | null = null;
  for (const candidate of services) {
    const characteristics = await candidate.getCharacteristics();
    const writable = pickWritable(characteristics);
    if (!writable) continue;
    service = candidate;
    characteristic = writable;
    notifyCharacteristic = characteristics.find((c) => c.properties.notify) ?? null;
    break;
  }
  if (!service || !characteristic) throw new Error("Connected, but found no writable characteristic to print to.");

  const target = characteristic;
  const mode = target.properties.write ? "with-response" : "without-response";

  return {
    device,
    serviceUuid: service.uuid,
    characteristicUuid: target.uuid,
    mode,
    async write(bytes, options = {}) {
      const { chunkSize, delayMs } = { ...WRITE_DEFAULTS, ...options };
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.slice(offset, offset + chunkSize);
        if (mode === "with-response") await target.writeValueWithResponse(chunk);
        else await target.writeValueWithoutResponse(chunk);
        options.onProgress?.(Math.min(offset + chunkSize, bytes.length), bytes.length);
        if (delayMs > 0) await sleep(delayMs);
      }
    },
    async onNotify(listener) {
      if (!notifyCharacteristic) return false;
      try {
        await notifyCharacteristic.startNotifications();
        notifyCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
          const value = (event.target as unknown as { value?: DataView }).value;
          if (value) listener(new Uint8Array(value.buffer));
        });
        return true;
      } catch {
        return false;
      }
    },
    disconnect() {
      if (device.gatt?.connected) device.gatt.disconnect();
    },
  };
}
