/**
 * 信道占用与重叠图的**布局计算**（纯函数）
 *
 * 无线电频谱不是格子：WiFi 一个信道占约 22 MHz，在 2.4 GHz 上正好等于 5 个信道号 ——
 * 所以 1 与 3 严重重叠、1 与 6 刚好相接、1 与 11 完全分开（这就是"只用 1/6/11"的由来）。
 * 5 GHz / 6 GHz 的信道是正交的，只有**同频**才互相干扰。
 *
 * 这个模块只把测量结果换算成"画得出来"的坐标：每条信号占哪一段频谱、
 * 哪几段被两条以上信号叠着（＝真正会互相干扰的区间）。渲染在 `ChannelChart.tsx`。
 *
 * 输出全部是**信道号单位**下的连续区间，绘制层再线性映射到像素 ——
 * 这样"重叠多少"这件事可以被单测钉住，而不是靠肉眼看图。
 */

import type { ChannelUsage } from '@toposmith/anvil';
import type { WifiBand } from '@toposmith/schema';

/** 2.4 GHz 一个信道占的宽度（信道号单位）：约 22 MHz ÷ 5 MHz */
export const CHANNEL_WIDTH_24G = 5;
/** 2.4G 可画范围：1–14（14 只在日本用，但画出来不吃亏） */
export const RANGE_24G: [number, number] = [1, 14];

export interface SpectrumCurve {
  /** 设备名（图例与悬浮提示用） */
  name: string;
  /** 峰值所在的信道号 */
  channel: number;
  /** 频谱区间（信道号） */
  from: number;
  to: number;
}

export interface ChannelBar {
  channel: number;
  /** 该信道上有几个信号 */
  count: number;
  names: string[];
}

/** 一段"两条以上信号叠在一起"的频谱区间 */
export interface OverlapSpan {
  from: number;
  to: number;
  kind: 'co-channel' | 'adjacent';
}

export interface BandChart {
  band: WifiBand | 'cellular';
  /** 该图的横轴范围（信道号）；蜂窝没有信道号，用 [0, 1] 占位 */
  range: [number, number];
  /** 横轴每一格代表的频率宽度（MHz），用于标注 "5 MHz/格" */
  mhzPerUnit: number;
  /** 2.4G：每台设备的频谱穹顶（重叠图的主体） */
  curves: SpectrumCurve[];
  /** 正交频段：每个信道上的信号条 */
  bars: ChannelBar[];
  /** 需要高亮的重叠区间 */
  overlaps: OverlapSpan[];
  /** 该频段是否有干扰（决定标题的颜色） */
  hasInterference: boolean;
}

/** 蜂窝没有信道号：整段频谱用一格表示 */
const CELLULAR_RANGE: [number, number] = [0, 1];

export function buildChannelCharts(channels: ChannelUsage[]): BandChart[] {
  const byBand = new Map<string, ChannelUsage[]>();
  for (const usage of channels) {
    const list = byBand.get(usage.band) ?? [];
    list.push(usage);
    byBand.set(usage.band, list);
  }

  const charts: BandChart[] = [];
  for (const [band, usages] of byBand) {
    if (band === 'cellular') {
      charts.push({
        band: 'cellular',
        range: CELLULAR_RANGE,
        mhzPerUnit: 1,
        curves: [],
        bars: usages.map((usage) => ({
          channel: 0,
          count: usage.signals.length,
          names: usage.signals.map((signal) => signal.deviceName),
        })),
        overlaps: [],
        hasInterference: usages.some((usage) => usage.interference !== 'none'),
      });
      continue;
    }

    const wifiBand = band as WifiBand;
    const bars: ChannelBar[] = usages
      .map((usage) => ({
        channel: usage.channel,
        count: usage.signals.length,
        names: usage.signals.map((signal) => signal.deviceName),
      }))
      .sort((a, b) => a.channel - b.channel);

    if (wifiBand === '2.4G') {
      const curves: SpectrumCurve[] = usages.map((usage) => ({
        name: usage.signals[0]?.deviceName ?? '未知',
        channel: usage.channel,
        from: usage.channel - CHANNEL_WIDTH_24G / 2,
        to: usage.channel + CHANNEL_WIDTH_24G / 2,
      }));
      const overlaps = overlapSpans(curves);
      charts.push({
        band: wifiBand,
        range: RANGE_24G,
        mhzPerUnit: 5,
        curves,
        bars,
        overlaps,
        hasInterference: overlaps.length > 0,
      });
      continue;
    }

    // 5G / 6G：信道正交，画成离散的占用条，横轴按实际用到的信道收紧（两端各留一格）
    const used = bars.map((bar) => bar.channel);
    const min = Math.max(1, Math.min(...used) - 2);
    const max = Math.min(233, Math.max(...used) + 2);
    charts.push({
      band: wifiBand,
      range: [min, max],
      mhzPerUnit: 5,
      curves: [],
      bars,
      // 正交信道之间没有重叠区间；同频由 bars 上的 count ≥ 2 表达
      overlaps: [],
      hasInterference: bars.some((bar) => bar.count > 1),
    });
  }

  // 频段顺序固定：2.4G → 5G → 6G → 蜂窝（结果与输入顺序无关）
  const order: (WifiBand | 'cellular')[] = ['2.4G', '5G', '6G', 'cellular'];
  return charts.sort((a, b) => order.indexOf(a.band) - order.indexOf(b.band));
}

/**
 * 找出所有"被两条以上频谱穹顶覆盖"的区间。
 *
 * 做法是扫描线：把每台设备的频谱区间端点收集起来，逐个小区间数一次覆盖数 ——
 * 区间数很小（一个测量点附近的 AP 个数），不需要更聪明。
 * 相邻的两个重叠小区间会合并，避免图上出现一堆细缝。
 */
export function overlapSpans(curves: SpectrumCurve[]): OverlapSpan[] {
  if (curves.length < 2) return [];
  const points = [...new Set(curves.flatMap((curve) => [curve.from, curve.to]))].sort((a, b) => a - b);

  const spans: OverlapSpan[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const from = points[i] as number;
    const to = points[i + 1] as number;
    const mid = (from + to) / 2;
    const covering = curves.filter((curve) => curve.from <= mid && curve.to >= mid);
    if (covering.length < 2) continue;
    // 峰值在同一信道 = 同频；否则是相邻信道重叠
    const sameChannel = new Set(covering.map((curve) => curve.channel)).size === 1;
    const kind: OverlapSpan['kind'] = sameChannel ? 'co-channel' : 'adjacent';
    const last = spans[spans.length - 1];
    if (last && last.kind === kind && Math.abs(last.to - from) < 1e-9) {
      last.to = to;
      continue;
    }
    spans.push({ from, to, kind });
  }
  return spans;
}

/** 横轴刻度：2.4G 逐信道，其余每 2–4 格标一个（避免挤成一团） */
export function channelTicks(chart: BandChart): number[] {
  const [min, max] = chart.range;
  if (chart.band === 'cellular') return [0];
  const step = max - min <= 16 ? 1 : 4;
  const ticks: number[] = [];
  for (let channel = min; channel <= max; channel += step) ticks.push(channel);
  return ticks;
}
