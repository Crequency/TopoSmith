/**
 * 信道重叠图单测
 *
 * 这张图的意义就是"让人一眼看出挤不挤"，所以它必须**算得对**：
 * 1 与 3 要重叠、1 与 6 要刚好相接（不重叠）、1 与 11 要完全分开；
 * 5G/6G 只有同频才算干扰。这些数字（一个信道 = 5 个信道号宽）钉在测试里，
 * 免得哪天"图好看了但结论错了"。
 */

import { describe, expect, it } from 'vitest';
import { instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, omniCoverage, type Cable, type Device, type Scenario } from '@toposmith/schema';
import { buildWorld, measureWireless } from '@toposmith/anvil';
import { buildChannelCharts, channelTicks, overlapSpans } from '../channel-chart';

function radio(
  id: string,
  name: string,
  x: number,
  wireless: Device['wireless'],
): Device {
  const device = instantiate('ap', id, name, x, 0);
  device.wireless = wireless;
  return device;
}

function measure(devices: Device[], cables: Cable[] = []) {
  const scenario: Scenario = {
    schemaVersion: SCHEMA_VERSION,
    id: 'chart-fixture',
    name: 'chart fixture',
    devices,
    cables,
    updatedAt: '2026-09-18T00:00:00.000Z',
  };
  const world = buildWorld(scenario);
  // 测第一台设备的卡片中心：它一定在自己的覆盖里，也尽量落在其他设备的覆盖里
  const first = devices[0] as Device;
  return measureWireless(world, { x: first.x + 76, y: first.y + 43 });
}

describe('频谱重叠区间的计算', () => {
  it('1 与 3：重叠 3 个信道宽（严重重叠）', () => {
    const spans = overlapSpans([
      { name: 'A', channel: 1, from: -1.5, to: 3.5 },
      { name: 'B', channel: 3, from: 0.5, to: 5.5 },
    ]);
    expect(spans).toEqual([{ from: 0.5, to: 3.5, kind: 'adjacent' }]);
  });

  it('1 与 6：刚好相接，不重叠', () => {
    const spans = overlapSpans([
      { name: 'A', channel: 1, from: -1.5, to: 3.5 },
      { name: 'B', channel: 6, from: 3.5, to: 8.5 },
    ]);
    expect(spans).toEqual([]);
  });

  it('1 与 11：完全分开', () => {
    const spans = overlapSpans([
      { name: 'A', channel: 1, from: -1.5, to: 3.5 },
      { name: 'B', channel: 11, from: 8.5, to: 13.5 },
    ]);
    expect(spans).toEqual([]);
  });

  it('同信道：整段都是同频重叠', () => {
    const spans = overlapSpans([
      { name: 'A', channel: 6, from: 3.5, to: 8.5 },
      { name: 'B', channel: 6, from: 3.5, to: 8.5 },
    ]);
    expect(spans).toEqual([{ from: 3.5, to: 8.5, kind: 'co-channel' }]);
  });

  it('连续的重叠区间会合并成一段（图上不出现细缝），换一种干扰类型才断开', () => {
    const adjacentThenAdjacent = overlapSpans([
      { name: 'A', channel: 1, from: -1.5, to: 3.5 },
      { name: 'B', channel: 3, from: 0.5, to: 5.5 },
      { name: 'C', channel: 6, from: 3.5, to: 8.5 },
    ]);
    // 0.5–3.5 是 A+B，3.5–5.5 是 B+C，同为邻频 → 合并成 0.5–5.5
    expect(adjacentThenAdjacent).toEqual([{ from: 0.5, to: 5.5, kind: 'adjacent' }]);

    const mixedWithCoChannel = overlapSpans([
      { name: 'A', channel: 1, from: -1.5, to: 3.5 },
      { name: 'B', channel: 1, from: -1.5, to: 3.5 },
      { name: 'C', channel: 3, from: 0.5, to: 5.5 },
    ]);
    // 同频那一段（−1.5–0.5）与邻频那一段（0.5–3.5）类型不同，分开画
    expect(mixedWithCoChannel.map((span) => span.kind)).toEqual(['co-channel', 'adjacent']);
  });
});

describe('频段图', () => {
  it('2.4G：两台相邻信道的 AP → 画出两条穹顶 + 一段重叠', () => {
    const a = radio('dev-a', 'AP-ch1', 0, {
      mode: 'ap',
      ssid: 'Lab',
      band: '2.4G',
      standard: '802.11n',
      channel: 1,
      coverage: omniCoverage(60),
    });
    const b = radio('dev-b', 'AP-ch3', 300, {
      mode: 'ap',
      ssid: 'Lab',
      band: '2.4G',
      standard: '802.11n',
      channel: 3,
      coverage: omniCoverage(60),
    });
    const charts = buildChannelCharts(measure([a, b]).channels);
    expect(charts).toHaveLength(1);
    const chart = charts[0]!;
    expect(chart.band).toBe('2.4G');
    expect(chart.range).toEqual([1, 14]);
    expect(chart.curves.map((curve) => curve.channel)).toEqual([1, 3]);
    expect(chart.overlaps).toHaveLength(1);
    expect(chart.hasInterference).toBe(true);
  });

  it('2.4G：1 与 6 是"刚好分开"的经典配置 → 没有重叠', () => {
    const a = radio('dev-a', 'AP-ch1', 0, {
      mode: 'ap',
      ssid: 'Lab',
      band: '2.4G',
      standard: '802.11n',
      channel: 1,
      coverage: omniCoverage(60),
    });
    const b = radio('dev-b', 'AP-ch6', 300, {
      mode: 'ap',
      ssid: 'Lab',
      band: '2.4G',
      standard: '802.11n',
      channel: 6,
      coverage: omniCoverage(60),
    });
    const chart = buildChannelCharts(measure([a, b]).channels)[0]!;
    expect(chart.overlaps).toEqual([]);
    expect(chart.hasInterference).toBe(false);
  });

  it('5G：不同信道 → 只画占用条、无重叠；同信道 → 标出干扰', () => {
    const a = radio('dev-a', 'AP-149', 0, {
      mode: 'ap',
      ssid: 'Lab',
      band: '5G',
      standard: '802.11ax',
      channel: 149,
      coverage: omniCoverage(60),
    });
    const b = radio('dev-b', 'AP-44', 300, {
      mode: 'ap',
      ssid: 'Lab',
      band: '5G',
      standard: '802.11ax',
      channel: 44,
      coverage: omniCoverage(60),
    });
    const orthogonal = buildChannelCharts(measure([a, b]).channels)[0]!;
    expect(orthogonal.bars.map((bar) => bar.channel)).toEqual([44, 149]);
    expect(orthogonal.overlaps).toEqual([]);
    expect(orthogonal.hasInterference).toBe(false);
    expect(channelTicks(orthogonal).length).toBeGreaterThan(2);

    const c = radio('dev-c', 'AP-149-2', 300, {
      mode: 'ap',
      ssid: 'Lab',
      band: '5G',
      standard: '802.11ax',
      channel: 149,
      coverage: omniCoverage(60),
    });
    const coChannel = buildChannelCharts(measure([a, c]).channels)[0]!;
    expect(coChannel.hasInterference).toBe(true);
    expect(coChannel.bars.find((bar) => bar.channel === 149)?.count).toBe(2);
    // 正交频段的横轴按实际用到的信道收紧，不会从 1 画到 233
    expect(coChannel.range[0]).toBeGreaterThan(1);
  });

  it('蜂窝单独一张图（没有信道号），频段顺序固定', () => {
    const wifi = radio('dev-a', 'AP', 0, {
      mode: 'ap',
      ssid: 'Lab',
      band: '5G',
      standard: '802.11ax',
      channel: 149,
      coverage: omniCoverage(60),
    });
    const bs = instantiate('bs-5g', 'dev-bs', '5G 基站', 300, 0);
    const charts = buildChannelCharts(measure([wifi, bs]).channels);
    expect(charts.map((chart) => chart.band)).toEqual(['5G', 'cellular']);
    const cellular = charts[1]!;
    expect(cellular.range).toEqual([0, 1]);
    expect(cellular.bars[0]?.names).toContain('5G 基站');
    expect(channelTicks(cellular)).toEqual([0]);
  });
});
