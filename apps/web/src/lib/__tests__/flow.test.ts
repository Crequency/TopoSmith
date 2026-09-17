/** 链路流向动画模型单测：路径构建 / 速度映射 / 推进与阻断 */

import { describe, expect, it } from 'vitest';
import type { Hop } from '@toposmith/engine';
import {
  advanceDistance,
  buildFlowPath,
  hopIndexAt,
  initialDistances,
  isStopped,
  pointAt,
  speedAt,
  visualSpeedForLink,
  type FlowResolver,
} from '../flow';

/** 三台设备排成一条水平线：A(0,0) —1G— B(100,0) —10G— C(200,0) */
const CENTERS: Record<string, { x: number; y: number }> = {
  A: { x: 0, y: 0 },
  B: { x: 100, y: 0 },
  C: { x: 200, y: 0 },
};

const resolver: FlowResolver = {
  center: (deviceId) => CENTERS[deviceId],
  segmentsForHop: (hop) => {
    if (hop.deviceId === 'A') {
      return [
        { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], speedMbps: 1000, family: 'copper' },
      ];
    }
    if (hop.deviceId === 'B') {
      return [
        { points: [{ x: 100, y: 0 }, { x: 200, y: 0 }], speedMbps: 10000, family: 'fiber' },
      ];
    }
    return [];
  },
};

function hops(): Hop[] {
  return [
    {
      index: 0,
      deviceId: 'A',
      deviceName: 'A',
      outPort: 'GE1',
      outPortId: 'p1',
      linkSpeedMbps: 1000,
      linkFamily: 'copper',
    },
    {
      index: 1,
      deviceId: 'B',
      deviceName: 'B',
      outPort: 'SFP1',
      outPortId: 'p1',
      linkSpeedMbps: 10000,
      linkFamily: 'fiber',
    },
    { index: 2, deviceId: 'C', deviceName: 'C', note: '目的地' },
  ];
}

describe('视觉速度映射', () => {
  it('按链路速率对数映射：100M 最慢、10G 明显更快', () => {
    const slow = visualSpeedForLink(100);
    const gigabit = visualSpeedForLink(1000);
    const tenGig = visualSpeedForLink(10000);
    expect(slow).toBe(55);
    expect(gigabit).toBe(110);
    expect(tenGig).toBe(165);
    expect(slow).toBeLessThan(gigabit);
    expect(gigabit).toBeLessThan(tenGig);
  });

  it('速率低于 100M 或为 0 时按 100M 兜底（不出现静止或倒流）', () => {
    expect(visualSpeedForLink(0)).toBe(55);
    expect(visualSpeedForLink(10)).toBe(55);
  });
});

describe('路径构建', () => {
  it('按逐跳顺序拼出折线、分段与逐跳标记', () => {
    const path = buildFlowPath(hops(), resolver, true)!;
    expect(path.total).toBe(200);
    expect(path.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ]);
    expect(path.segments.map((s) => [s.start, s.end, s.speedMbps])).toEqual([
      [0, 100, 1000],
      [100, 200, 10000],
    ]);
    expect(path.hopMarks.map((m) => m.at)).toEqual([0, 100, 200]);
    expect(path.minSpeedMbps).toBe(1000);
    expect(path.maxSpeedMbps).toBe(10000);
    expect(path.stopAt).toBeNull();
  });

  it('路径缺少几何信息时返回 null（调用方安静退回静态高亮）', () => {
    expect(
      buildFlowPath(hops(), { center: () => undefined, segmentsForHop: () => [] }, true),
    ).toBeNull();
    expect(buildFlowPath([], resolver, true)).toBeNull();
    // DNS 解析链这类 hop 没有 outPortId
    const dnsLike: Hop[] = [{ index: 0, deviceId: '203.0.113.10', deviceName: '云 DNS' }];
    expect(buildFlowPath(dnsLike, resolver, true)).toBeNull();
  });

  it('一跳可以包含多段二层链路（中间交换机不再被跳过）', () => {
    const multiResolver: FlowResolver = {
      center: (deviceId) => CENTERS[deviceId],
      segmentsForHop: (hop) =>
        hop.deviceId === 'A'
          ? [
              {
                points: [{ x: 0, y: 0 }, { x: 25, y: 10 }, { x: 50, y: 0 }],
                speedMbps: 1201,
                family: 'wireless',
              },
              {
                points: [{ x: 50, y: 0 }, { x: 100, y: 0 }],
                speedMbps: 1000,
                family: 'copper',
              },
            ]
          : [],
    };
    const path = buildFlowPath(hops(), multiResolver, true)!;
    // 同一跳的多个二层链路段都在路径里（折线会被进一步拆成小段）
    const speeds = path.segments.map((segment) => segment.speedMbps);
    expect(speeds).toContain(1201);
    expect(speeds).toContain(1000);
    // 瓶颈必须是那条被交换机"藏起来"的 1G 链路，而不是无线段的 1201
    expect(path.minSpeedMbps).toBe(1000);
  });

  it('失败路径把阻断点设为终点，粒子不会越过', () => {
    const path = buildFlowPath(hops(), resolver, false)!;
    expect(path.kind).toBe('failed');
    expect(path.stopAt).toBe(path.total);
  });
});

describe('推进与阻断', () => {
  it('同一时刻不同段的速度不同 —— 动画确实反映链路速率', () => {
    const path = buildFlowPath(hops(), resolver, true)!;
    expect(speedAt(path, 50)).toBe(110); // 1G 段
    expect(speedAt(path, 150)).toBe(165); // 10G 段
    expect(hopIndexAt(path, 50)).toBe(0);
    expect(hopIndexAt(path, 150)).toBe(1);
  });

  it('成功路径越界后回绕，形成持续流动', () => {
    const path = buildFlowPath(hops(), resolver, true)!;
    expect(advanceDistance(path, 195, 1, 1)).toBeCloseTo(160, 5); // 195 + 165 - 200
    expect(advanceDistance(path, 10, 1, 1)).toBeCloseTo(120, 5); // 10 + 110
  });

  it('失败路径停在阻断点，并可判定"已停止"', () => {
    const path = buildFlowPath(hops(), resolver, false)!;
    expect(advanceDistance(path, 195, 1, 1)).toBe(200);
    expect(isStopped(path, 200)).toBe(true);
    expect(isStopped(path, 180)).toBe(false);
  });

  it('倍率线性影响推进距离', () => {
    const path = buildFlowPath(hops(), resolver, true)!;
    // 用较短的 dt，避免推进到终点后回绕，从而掩盖倍率关系
    const once = advanceDistance(path, 10, 0.1, 1);
    const twice = advanceDistance(path, 10, 0.1, 2);
    expect(twice - 10).toBeCloseTo((once - 10) * 2, 5);
  });
});

describe('取点与粒子分布', () => {
  it('pointAt 沿折线线性插值', () => {
    const path = buildFlowPath(hops(), resolver, true)!;
    expect(pointAt(path, 50)).toEqual({ x: 50, y: 0 });
    expect(pointAt(path, 150)).toEqual({ x: 150, y: 0 });
    expect(pointAt(path, 999)).toEqual({ x: 200, y: 0 }); // 越界钳制
  });

  it('粒子按间距铺满路径，数量有上下限', () => {
    const path = buildFlowPath(hops(), resolver, true)!;
    const distances = initialDistances(path);
    expect(distances.length).toBeGreaterThanOrEqual(2);
    expect(distances.length).toBeLessThanOrEqual(14);
    expect(distances[0]).toBe(0);
    expect(distances[distances.length - 1]!).toBeLessThan(path.total);
  });
});
