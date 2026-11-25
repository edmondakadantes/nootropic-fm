/**
 * nootropic.fm v7.1 — Optional Web Bluetooth Heart Rate / RR-Interval (HRV) Monitor
 *
 * Connects to standard Bluetooth Low Energy Heart Rate straps/sensors (Service 0x180D,
 * Characteristic 0x2A37), parses IEEE/Bluetooth SIG flags + 1/1024 s RR-intervals into
 * milliseconds, and computes live RMSSD, HR (BPM), and 0.04–0.15 Hz LF power ratio.
 */

import { computeHrvMetricsFromRrMs, type HrvBiomarkerResult } from '../../shared/psychometrics';

export interface BleHrvState {
  connected: boolean;
  deviceName: string | null;
  latestHrBpm: number | null;
  metrics: HrvBiomarkerResult | null;
}

/**
 * Decodes standard Bluetooth SIG Heart Rate Measurement (0x2A37) notification payload.
 */
export function parseBleHeartRateMeasurement(data: DataView): {
  hrBpm: number;
  rrIntervalsMs: number[];
} {
  const flags = data.getUint8(0);
  const isUint16Hr = (flags & 0x01) !== 0;
  const energyExpendedPresent = (flags & 0x08) !== 0;
  const rrPresent = (flags & 0x10) !== 0;

  let offset = 1;
  const hrBpm = isUint16Hr ? data.getUint16(offset, true) : data.getUint8(offset);
  offset += isUint16Hr ? 2 : 1;

  if (energyExpendedPresent && offset + 2 <= data.byteLength) {
    offset += 2;
  }

  const rrIntervalsMs: number[] = [];
  if (rrPresent) {
    while (offset + 1 < data.byteLength) {
      // Spec resolution is 1/1024 sec per unit
      const raw = data.getUint16(offset, true);
      offset += 2;
      const rrMs = (raw / 1024) * 1000;
      if (rrMs >= 300 && rrMs <= 2000) {
        rrIntervalsMs.push(rrMs);
      }
    }
  }

  return { hrBpm, rrIntervalsMs };
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export class BleHrvMonitor {
  private rrBuffer: number[] = [];
  private device: { name?: string; gatt?: { connected?: boolean; disconnect: () => void }; addEventListener: (e: string, cb: () => void) => void } | null = null;
  private onUpdateCb: ((state: BleHrvState) => void) | null = null;
  private latestHrBpm: number | null = null;
  private lastMetrics: HrvBiomarkerResult | null = null;

  public async connect(onUpdate: (state: BleHrvState) => void): Promise<boolean> {
    if (!isWebBluetoothSupported()) return false;
    this.onUpdateCb = onUpdate;

    type BleNavigator = Navigator & {
      bluetooth: {
        requestDevice: (opts: {
          filters: Array<{ services: number[] }>;
        }) => Promise<{
          name?: string;
          gatt?: {
            connected?: boolean;
            connect: () => Promise<{
              getPrimaryService: (svc: number) => Promise<{
                getCharacteristic: (chr: number) => Promise<{
                  startNotifications: () => Promise<void>;
                  addEventListener: (
                    ev: string,
                    cb: (e: { target?: { value?: DataView } }) => void
                  ) => void;
                }>;
              }>;
            }>;
            disconnect: () => void;
          };
          addEventListener: (e: string, cb: () => void) => void;
        }>;
      };
    };

    try {
      const bleNav = navigator as BleNavigator;
      const dev = await bleNav.bluetooth.requestDevice({
        filters: [{ services: [0x180d] }],
      });
      this.device = dev;
      this.rrBuffer = [];
      this.latestHrBpm = null;
      this.lastMetrics = null;

      dev.addEventListener('gattserverdisconnected', () => {
        this.emitState(false);
      });

      const server = await dev.gatt?.connect();
      if (!server) return false;
      const service = await server.getPrimaryService(0x180d);
      const char = await service.getCharacteristic(0x2a37);
      await char.startNotifications();

      char.addEventListener('characteristicvaluechanged', (evt) => {
        const val = evt.target?.value;
        if (!val) return;
        const parsed = parseBleHeartRateMeasurement(val);
        this.latestHrBpm = parsed.hrBpm;
        if (parsed.rrIntervalsMs.length > 0) {
          this.rrBuffer.push(...parsed.rrIntervalsMs);
          if (this.rrBuffer.length > 240) {
            this.rrBuffer = this.rrBuffer.slice(-240);
          }
        } else if (parsed.hrBpm > 30 && parsed.hrBpm < 210) {
          this.rrBuffer.push(60000 / parsed.hrBpm);
          if (this.rrBuffer.length > 240) {
            this.rrBuffer = this.rrBuffer.slice(-240);
          }
        }
        this.lastMetrics = computeHrvMetricsFromRrMs(this.rrBuffer);
        this.emitState(true);
      });

      this.emitState(true);
      return true;
    } catch {
      return false;
    }
  }

  public getSnapshot(): BleHrvState {
    return {
      connected: Boolean(this.device?.gatt?.connected),
      deviceName: this.device?.name ?? null,
      latestHrBpm: this.latestHrBpm,
      metrics: this.lastMetrics,
    };
  }

  public disconnect(): void {
    try {
      this.device?.gatt?.disconnect();
    } catch {
      // ignore
    }
    this.device = null;
    this.emitState(false);
  }

  private emitState(connected: boolean): void {
    this.onUpdateCb?.({
      connected,
      deviceName: this.device?.name ?? null,
      latestHrBpm: this.latestHrBpm,
      metrics: this.lastMetrics,
    });
  }
}
