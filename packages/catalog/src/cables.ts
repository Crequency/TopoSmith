/**
 * 线缆目录与物理约束
 *
 * 本文件是产品的差异化所在：把"用户随手画的一根线"变成**参与计算**的物理对象。
 * 每个数字都要有出处（standard / note），否则可信度会崩塌 —— 见 docs/03-catalog.md §3。
 */

import type { CableType, PortMedium } from '@toposmith/schema';
import { SPEED } from './speeds';

export type CableFamily = 'copper' | 'fiber' | 'wireless';

/** 速率分档：取**第一个**满足 lengthM ≤ maxLengthM 的档位 */
export interface CableSpeedTier {
  maxLengthM: number;
  speedMbps: number;
}

export interface CableSpec {
  type: CableType;
  /** 标准/正式名称 */
  label: string;
  /** 市面俗称（与 label 不同时必须展示，避免用户按错名称采购或建模） */
  alias?: string;
  family: CableFamily;
  pairsWith: PortMedium[];
  standard: string;
  maxLengthM: number;
  speedTiers: CableSpeedTier[];
  note?: string;
  /** 是否按长度分档决定速率（铜缆/多模光纤为 true，单模与 DAC 为 false） */
  lengthSensitive: boolean;
}

export const CABLE_SPECS: CableSpec[] = [
  {
    type: 'cat5',
    label: 'CAT5',
    family: 'copper',
    pairsWith: ['rj45'],
    standard: 'TIA/EIA-568-A Cat5',
    maxLengthM: 100,
    speedTiers: [{ maxLengthM: 100, speedMbps: SPEED.eth100 }],
    lengthSensitive: true,
    note: '仅支持 100 Mbps；2.5G/5G/10G 需要 CAT5e 及以上。',
  },
  {
    type: 'cat5e',
    label: 'CAT5e',
    family: 'copper',
    pairsWith: ['rj45'],
    standard: 'TIA/EIA-568-B Cat5e',
    maxLengthM: 100,
    speedTiers: [{ maxLengthM: 100, speedMbps: SPEED.eth2_5g }],
    lengthSensitive: true,
    note: '2.5GBASE-T 需两端支持 NBASE-T；100 m 内不支持 10GBASE-T。',
  },
  {
    type: 'cat6',
    label: 'CAT6',
    family: 'copper',
    pairsWith: ['rj45'],
    standard: 'TIA/EIA-568-C.2 Cat6',
    maxLengthM: 100,
    speedTiers: [
      { maxLengthM: 55, speedMbps: SPEED.eth10g },
      { maxLengthM: 100, speedMbps: SPEED.eth2_5g },
    ],
    lengthSensitive: true,
    note: '10GBASE-T 仅支持到 55 m（永久链路约 37 m）；100 m 内降至 2.5G。',
  },
  {
    type: 'cat6a',
    label: 'CAT6a',
    alias: 'CAT6e',
    family: 'copper',
    pairsWith: ['rj45'],
    standard: 'TIA/EIA-568-C.2 Cat6a',
    maxLengthM: 100,
    speedTiers: [{ maxLengthM: 100, speedMbps: SPEED.eth10g }],
    lengthSensitive: true,
    note: '「CAT6e」是市面俗称，从未被 TIA/EIA 采纳；本目录统一映射到 CAT6a。',
  },
  {
    type: 'lc-om3',
    label: 'OM3 多模光纤 (LC-LC)',
    family: 'fiber',
    pairsWith: ['sfp', 'pon'],
    standard: 'ISO/IEC 11801 OM3',
    maxLengthM: 300,
    speedTiers: [
      { maxLengthM: 100, speedMbps: SPEED.eth40g },
      { maxLengthM: 300, speedMbps: SPEED.eth10g },
    ],
    lengthSensitive: true,
    note: '速率上限由两端光模块决定，本档位是线缆侧的传输能力。',
  },
  {
    type: 'lc-om4',
    label: 'OM4 多模光纤 (LC-LC)',
    family: 'fiber',
    pairsWith: ['sfp', 'pon'],
    standard: 'ISO/IEC 11801 OM4',
    maxLengthM: 550,
    speedTiers: [
      { maxLengthM: 150, speedMbps: SPEED.eth40g },
      { maxLengthM: 550, speedMbps: SPEED.eth10g },
    ],
    lengthSensitive: true,
    note: '与 OM3 同为多模，但带宽距离积更高，万兆可跑 550 m。',
  },
  {
    type: 'lc-sm',
    label: '单模光纤 (LC-LC)',
    family: 'fiber',
    pairsWith: ['sfp', 'pon'],
    standard: 'ITU-T G.652.D / OS2',
    maxLengthM: 10000,
    speedTiers: [{ maxLengthM: 10000, speedMbps: SPEED.eth100g }],
    lengthSensitive: false,
    note: '长距离骨干介质；实际速率仍由两端光模块决定。',
  },
  {
    type: 'dac',
    label: 'DAC 高速铜缆',
    family: 'copper',
    pairsWith: ['sfp'],
    standard: 'SFF-8431 (直接附加铜缆)',
    maxLengthM: 5,
    speedTiers: [{ maxLengthM: 5, speedMbps: SPEED.eth25g }],
    lengthSensitive: false,
    note: '机柜内堆叠/上联用；超过 5 m 无法保证信号完整性。',
  },
  {
    type: 'wireless',
    label: '无线关联 (WiFi)',
    family: 'wireless',
    pairsWith: ['wifi'],
    standard: 'IEEE 802.11',
    maxLengthM: 0,
    speedTiers: [{ maxLengthM: Number.POSITIVE_INFINITY, speedMbps: 0 }],
    lengthSensitive: false,
    note: '无线关联没有长度概念；速率由两端 802.11 标准协商得出。',
  },
];

const SPEC_BY_TYPE = new Map<CableType, CableSpec>(CABLE_SPECS.map((s) => [s.type, s]));

export function cableSpec(type: CableType): CableSpec {
  const spec = SPEC_BY_TYPE.get(type);
  if (!spec) throw new Error(`未登记的线缆类型：${type}`);
  return spec;
}

/** UI 展示名：俗称与标准名不同时一并展示 */
export function cableLabel(type: CableType): string {
  const spec = cableSpec(type);
  return spec.alias ? `${spec.label}（俗称 ${spec.alias}）` : spec.label;
}

/**
 * 该线缆在给定长度下的速率能力（Mbps）。
 *
 * 注意：超长**不在这里处理**（不由本函数返回 0）。超长是"链路 down"，
 * 属于可用性问题，由引擎判定并给出 LINK_TOO_LONG；本函数只回答"能力上限"。
 */
export function cableSpeedAt(spec: CableSpec, lengthM: number): number {
  for (const tier of spec.speedTiers) {
    if (lengthM <= tier.maxLengthM) return tier.speedMbps;
  }
  // 全部档位都不满足（例如 500 m 的 OM3）：取最低档能力，由引擎判超长
  const lowest = spec.speedTiers.reduce(
    (min, t) => (t.speedMbps < min ? t.speedMbps : min),
    Number.POSITIVE_INFINITY,
  );
  return Number.isFinite(lowest) ? lowest : 0;
}

/** 列出可与某介质配对的线缆类型，供 UI 过滤下拉框 */
export function cablesForMedium(medium: PortMedium): CableSpec[] {
  return CABLE_SPECS.filter((s) => s.pairsWith.includes(medium));
}
