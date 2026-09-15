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
 * This firmware is fragile: enumerating every service, or subscribing to a
 * notify characteristic outside the print service, makes it drop the
 * connection within seconds. So discovery stays narrow by default and
 * notifications are opt-in. It also sleeps on idle, so the link is
 * re-established on demand rather than assumed to be alive.
 *
 * Minimal Web Bluetooth types are declared locally rather than pulling in
 * @types/web-bluetooth for one module.
 */

/** ISSC transparent UART. The `49535343` prefix is ASCII for "ISSC". */
export const PRINTER_SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455";

/**
 * Other service UUIDs used by common ESC/POS BLE printers. Named up front
 * so a different unit can still be found — Web Bluetooth hides services
 * that were never requested — but only searched if the print service is
 * missing, or when the caller explicitly asks to discover everything.
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

export type OpenOptions = {
  serviceUuid?: string;
  characteristicUuid?: string;
  mode?: WriteMode;
  /**
   * Enumerate every service instead of just the print service. Diagnostic
   * only: this printer drops the connection when probed this way.
   */
  discoverAll?: boolean;
  /** Subscribe to printer status bytes. Also destabilises this firmware. */
  enableNotifications?: boolean;
};

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
  isConnected(): boolean;
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

const servicesOrEmpty = (server: GattServer, uuid?: string) =>
  server.getPrimaryServices(uuid).catch(() => [] as GattService[]);

/**
 * Connects (if needed) and locates the characteristic to print to by
 * inspecting what the printer exposes, rather than hardcoding a UUID that
 * varies between production runs of these clone printers.
 */
async function resolveTarget(device: PrinterDevice, options: OpenOptions) {
  if (!device.gatt) throw new Error("This device exposes no GATT server.");
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();

  // Narrow by default: this firmware disconnects if every service is walked.
  let services = await servicesOrEmpty(server, options.discoverAll ? undefined : PRINTER_SERVICE_UUID);
  if (!services.length) {
    for (const uuid of FALLBACK_SERVICE_UUIDS) {
      services = await servicesOrEmpty(server, uuid);
      if (services.length) break;
    }
  }
  if (!services.length) services = await servicesOrEmpty(server);
  if (!services.length) throw new Error("Connected, but the printer exposed no usable service.");

  const endpoints: PrinterEndpoint[] = [];
  const writable = new Map<string, { service: GattService; characteristic: GattCharacteristic }>();
  for (const service of services) {
    const characteristics = await service.getCharacteristics().catch(() => [] as GattCharacteristic[]);
    for (const characteristic of characteristics) {
      if (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse) continue;
      endpoints.push({
        serviceUuid: service.uuid,
        characteristicUuid: characteristic.uuid,
        canWrite: characteristic.properties.write,
        canWriteWithoutResponse: characteristic.properties.writeWithoutResponse,
      });
      writable.set(characteristic.uuid, { service, characteristic });
    }
  }
  if (!endpoints.length) throw new Error("Connected, but found no writable characteristic to print to.");

  const chosen =
    (options.characteristicUuid ? writable.get(options.characteristicUuid) : undefined) ??
    [...writable.values()].find((entry) => entry.service.uuid === PRINTER_SERVICE_UUID) ??
    writable.get(endpoints[0].characteristicUuid)!;

  // Only ever from the print service itself — subscribing across services
  // is what knocked this printer offline.
  const notify = options.enableNotifications
    ? ((await chosen.service.getCharacteristics().catch(() => [] as GattCharacteristic[])).find(
        (c) => c.properties.notify,
      ) ?? null)
    : null;

  const requested = options.mode ?? "auto";
  const mode =
    requested === "auto" ? (chosen.characteristic.properties.write ? "with-response" : "without-response") : requested;

  return { service: chosen.service, characteristic: chosen.characteristic, endpoints, notify, mode } as const;
}

/** Disconnect listeners are per-device, so a reconnect doesn't stack them up. */
const listening = new WeakSet<PrinterDevice>();

export function onPrinterDisconnected(device: PrinterDevice, listener: () => void) {
  if (listening.has(device)) return;
  listening.add(device);
  device.addEventListener("gattserverdisconnected", listener);
}

export async function openPrinter(device: PrinterDevice, options: OpenOptions = {}): Promise<PrinterLink> {
  let target = await resolveTarget(device, options);

  /**
   * The printer sleeps when idle and drops the link. Re-resolving gives
   * fresh characteristic handles — the old ones are dead after a
   * disconnect — so a print after a quiet spell just works.
   */
  async function ensureTarget() {
    if (!device.gatt?.connected) {
      target = await resolveTarget(device, { ...options, characteristicUuid: target.characteristic.uuid });
    }
    return target;
  }

  return {
    device,
    serviceUuid: target.service.uuid,
    characteristicUuid: target.characteristic.uuid,
    endpoints: target.endpoints,
    mode: target.mode,
    isConnected: () => Boolean(device.gatt?.connected),
    async write(bytes, options_ = {}) {
      const { chunkSize, delayMs } = { ...WRITE_DEFAULTS, ...options_ };
      let sent = 0;

      const sendAll = async () => {
        const current = await ensureTarget();
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          const chunk = bytes.slice(offset, offset + chunkSize);
          if (current.mode === "with-response") await current.characteristic.writeValueWithResponse(chunk);
          else await current.characteristic.writeValueWithoutResponse(chunk);
          sent = Math.min(offset + chunkSize, bytes.length);
          options_.onProgress?.(sent, bytes.length);
          if (delayMs > 0) await sleep(delayMs);
        }
      };

      try {
        await sendAll();
      } catch (error) {
        // Retry only if nothing landed yet: resending after a partial
        // receipt would print the first half twice.
        if (sent > 0) throw error;
        await sendAll();
      }
    },
    async onNotify(listener) {
      if (!target.notify) return false;
      try {
        await target.notify.startNotifications();
        target.notify.addEventListener("characteristicvaluechanged", (event) => {
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
