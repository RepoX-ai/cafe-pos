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

/** A writable characteristic the printer exposes — a candidate print target. */
export type PrinterEndpoint = {
  serviceUuid: string;
  characteristicUuid: string;
  canWrite: boolean;
  canWriteWithoutResponse: boolean;
};

export type WriteMode = "auto" | "with-response" | "without-response";

export type PrinterLink = {
  device: PrinterDevice;
  serviceUuid: string;
  characteristicUuid: string;
  /** Every writable characteristic found, so another can be tried if this one is silent. */
  endpoints: PrinterEndpoint[];
  /** Writes with acknowledgement give back-pressure; without is faster but can overrun the buffer. */
  mode: "with-response" | "without-response";
  write(bytes: Uint8Array, options?: WriteOptions): Promise<void>;
  /** Printer status bytes, when the unit reports any. Not all clones do. */
  onNotify(listener: (bytes: Uint8Array) => void): Promise<boolean>;
  disconnect(): void;
};

export type WriteOptions = {
  /**
   * Bytes per BLE write. Keep at 20 — the default BLE packet payload.
   * Anything larger becomes a "long write", which these clone printers
   * acknowledge at the Bluetooth layer and then silently discard.
   */
  chunkSize?: number;
  /** Pause between chunks so the printer's small buffer can drain. */
  delayMs?: number;
  onProgress?: (sent: number, total: number) => void;
};

const WRITE_DEFAULTS = { chunkSize: 20, delayMs: 40 };

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

/**
 * Connects and locates the writable characteristic by inspecting what the
 * printer actually exposes, rather than hardcoding a UUID that varies
 * between production runs of these clone printers.
 */
export async function openPrinter(
  device: PrinterDevice,
  options: { serviceUuid?: string; characteristicUuid?: string; mode?: WriteMode } = {},
): Promise<PrinterLink> {
  if (!device.gatt) throw new Error("This device exposes no GATT server.");
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();

  // Discover everything, not just the first match: when a printer accepts
  // bytes and prints nothing, the next thing to try is a different
  // characteristic, so the caller needs the full list.
  let services = await server.getPrimaryServices().catch(() => [] as GattService[]);
  if (!services.length) services = await server.getPrimaryServices(PRINTER_SERVICE_UUID);

  const endpoints: PrinterEndpoint[] = [];
  const writableByUuid = new Map<string, { service: GattService; characteristic: GattCharacteristic }>();
  let notifyCharacteristic: GattCharacteristic | null = null;

  for (const service of services) {
    const characteristics = await service.getCharacteristics().catch(() => [] as GattCharacteristic[]);
    for (const characteristic of characteristics) {
      const { write, writeWithoutResponse, notify } = characteristic.properties;
      if (write || writeWithoutResponse) {
        endpoints.push({
          serviceUuid: service.uuid,
          characteristicUuid: characteristic.uuid,
          canWrite: write,
          canWriteWithoutResponse: writeWithoutResponse,
        });
        writableByUuid.set(`${service.uuid}|${characteristic.uuid}`, { service, characteristic });
      }
      if (notify && !notifyCharacteristic) notifyCharacteristic = characteristic;
    }
  }
  if (!endpoints.length) throw new Error("Connected, but found no writable characteristic to print to.");

  const chosen = options.characteristicUuid
    ? [...writableByUuid.entries()].find(([key]) => key.endsWith(`|${options.characteristicUuid}`))?.[1]
    : undefined;
  const fallback = writableByUuid.get(`${endpoints[0].serviceUuid}|${endpoints[0].characteristicUuid}`)!;
  const preferred =
    chosen ??
    // Default to the transparent-UART pipe when present; it's the print path on the RPP02N.
    [...writableByUuid.entries()].find(([key]) => key.startsWith(`${PRINTER_SERVICE_UUID}|`))?.[1] ??
    fallback;

  const service = preferred.service;
  const target = preferred.characteristic;
  const requested = options.mode ?? "auto";
  const mode =
    requested === "auto"
      ? target.properties.write
        ? "with-response"
        : "without-response"
      : requested;

  return {
    device,
    serviceUuid: service.uuid,
    characteristicUuid: target.uuid,
    endpoints,
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
