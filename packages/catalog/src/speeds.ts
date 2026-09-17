/** 速率常量、格式化与无线标称速率表（docs/03-catalog.md §2） */

import type { WifiBand, WifiStandard } from '@toposmith/schema';

export const SPEED = {
  eth100: 100,
  eth1g: 1000,
  eth2_5g: 2500,
  eth5g: 5000,
  eth10g: 10000,
  eth25g: 25000,
  eth40g: 40000,
  eth100g: 100000,
} as const;

/** 人类可读速率；0 表示"未协商"。 */
export function formatSpeed(mbps: number | undefined): string {
  if (mbps === undefined) return '未知';
  if (mbps === 0) return '未协商';
  if (mbps >= 1000) {
    const g = mbps / 1000;
    return `${Number.isInteger(g) ? g : g.toFixed(1)} Gbps`;
  }
  return `${mbps} Mbps`;
}

/** 人类可读长度 */
export function formatLength(meters: number): string {
  if (meters === 0) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)} km`;
  return `${meters} m`;
}

export function formatMbpsAsBytesPerSecond(mbps: number): string {
  const bytesPerSec = (mbps * 1_000_000) / 8;
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = bytesPerSec;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/**
 * WiFi 单流标称速率（Mbps）。
 *
 * 这是**协商上限**，不是"能用多少"。无线是共享半双工介质，
 * 有效吞吐另有折扣，见 docs/05-engine.md §5。
 */
export const WIFI_NOMINAL: Record<WifiStandard, Partial<Record<WifiBand, number>>> = {
  '802.11n': { '2.4G': 150, '5G': 300 },
  '802.11ac': { '5G': 866 },
  '802.11ax': { '2.4G': 287, '5G': 1201, '6G': 1201 },
  '802.11be': { '5G': 2882, '6G': 2882 },
};

export function wifiNominalMbps(standard?: WifiStandard, band?: WifiBand): number {
  if (!standard) return 0;
  const table = WIFI_NOMINAL[standard];
  if (!table) return 0;
  if (band && table[band] !== undefined) return table[band] as number;
  // 未指定频段时取该标准的最高能力
  return Math.max(0, ...Object.values(table).map((v) => v ?? 0));
}

export const WIFI_BAND_LABEL: Record<WifiBand, string> = {
  '2.4G': '2.4 GHz',
  '5G': '5 GHz',
  '6G': '6 GHz',
};
