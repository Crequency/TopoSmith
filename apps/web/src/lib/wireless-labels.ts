/**
 * 无线测量结果的**展示文案与配色**（UI 常量，与引擎的机器可读值一一对应）
 *
 * 单独抽出来是因为有三处要用同一套说法：测量面板、设备面板的「从附近信号中选择」、
 * 以及将来可能出现的诊断条目。文案集中一份，改一处就全改（NFR-09 的准备）。
 */

import type { ChannelUsage, SignalQuality } from '@toposmith/anvil';
import type { WifiBand } from '@toposmith/schema';

export const QUALITY_LABEL: Record<SignalQuality, string> = {
  excellent: '极佳',
  good: '良好',
  fair: '一般',
  weak: '较弱',
};

/** 质量条的填充色 */
export const QUALITY_COLOR: Record<SignalQuality, string> = {
  excellent: 'bg-emerald-500',
  good: 'bg-sky-500',
  fair: 'bg-amber-500',
  weak: 'bg-rose-500',
};

/** 质量文字色 */
export const QUALITY_TEXT: Record<SignalQuality, string> = {
  excellent: 'text-emerald-300',
  good: 'text-sky-300',
  fair: 'text-amber-300',
  weak: 'text-rose-300',
};

/** 质量条长度：与引擎的档位边界一致（只用于视觉比例） */
export const QUALITY_RATIO: Record<SignalQuality, number> = {
  excellent: 1,
  good: 0.66,
  fair: 0.33,
  weak: 0.15,
};

export const BAND_LABEL: Record<WifiBand, string> = {
  '2.4G': '2.4 GHz',
  '5G': '5 GHz',
  '6G': '6 GHz',
};

export const INTERFERENCE_LABEL: Record<ChannelUsage['interference'], string> = {
  none: '无重叠',
  'co-channel': '同频干扰',
  adjacent: '邻频重叠',
};
