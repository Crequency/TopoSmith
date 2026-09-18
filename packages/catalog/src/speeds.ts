/** 速率常量、格式化与无线标称速率表（docs/03-catalog.md §2） */

import type {
  CellularStandard,
  RadioStandard,
  WifiBand,
  WifiStandard,
} from '@toposmith/schema';
import { isCellularStandard } from '@toposmith/schema';

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

/**
 * 蜂窝单用户标称速率（Mbps）——**按单用户峰值**取值，像 WiFi 一样是协商上限，
 * 不是"能用多少"：蜂窝是彻底的共享介质（一个小区内所有用户分同一份空口资源），
 * 有效吞吐另有折扣，见 docs/05-engine.md §5。
 *
 * 取值的口径：LTE Cat.4（常见 4G 手机/CPE）下行 150 Mbps；
 * NR（5G）中频单用户峰值约 1 Gbps。刻意不取毫米波/载波聚合的实验室峰值 ——
 * 那会让"5G 一定比有线快"成为错误结论。
 */
export const CELLULAR_NOMINAL: Record<CellularStandard, number> = {
  lte: 150,
  nr: 1000,
};

export const CELLULAR_STANDARD_LABEL: Record<CellularStandard, string> = {
  lte: 'LTE（4G）',
  nr: 'NR（5G）',
};

/**
 * 无线制式的标称速率：WiFi 看标准 + 频段，蜂窝只看制式。
 * 无线协商统一走这里，避免"两种无线各有一套速率表"。
 */
export function radioNominalMbps(standard?: RadioStandard, band?: WifiBand): number {
  if (!standard) return 0;
  if (isCellularStandard(standard)) return CELLULAR_NOMINAL[standard];
  return wifiNominalMbps(standard, band);
}

export const RADIO_STANDARD_LABEL: Record<RadioStandard, string> = {
  '802.11n': '802.11n',
  '802.11ac': '802.11ac',
  '802.11ax': '802.11ax',
  '802.11be': '802.11be',
  ...CELLULAR_STANDARD_LABEL,
};

export const WIFI_BAND_LABEL: Record<WifiBand, string> = {
  '2.4G': '2.4 GHz',
  '5G': '5 GHz',
  '6G': '6 GHz',
};
