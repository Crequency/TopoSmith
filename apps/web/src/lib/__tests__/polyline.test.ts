/** 折线弧长参数化单测（FR-46） */

import { describe, expect, it } from 'vitest';
import { nearestRatio, pointAtRatio, polylineLength } from '../polyline';
import type { Point } from '../geometry';

/** 一条"L"形折线：先向右 100，再向下 100 */
const L_SHAPE: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

describe('折线弧长参数化', () => {
  it('总长按各段求和（不是首尾直线距离）', () => {
    expect(polylineLength(L_SHAPE)).toBeCloseTo(200, 6);
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBeCloseTo(5, 6);
  });

  it('比例 0 / 0.5 / 1 分别落在起点、弧长中点、终点', () => {
    expect(pointAtRatio(L_SHAPE, 0)).toEqual({ x: 0, y: 0 });
    // 弧长中点落在拐角处 —— 若按"点下标"取中点会错误地得到 (100, 0) 之外的其它点
    expect(pointAtRatio(L_SHAPE, 0.5)).toEqual({ x: 100, y: 0 });
    expect(pointAtRatio(L_SHAPE, 1)).toEqual({ x: 100, y: 100 });
  });

  it('比例越界被钳制到两端，而不是外推', () => {
    expect(pointAtRatio(L_SHAPE, -3)).toEqual({ x: 0, y: 0 });
    expect(pointAtRatio(L_SHAPE, 9)).toEqual({ x: 100, y: 100 });
    expect(pointAtRatio(L_SHAPE, Number.NaN)).toEqual({ x: 0, y: 0 });
  });

  it('取点与反推互为逆运算（往返误差可忽略）', () => {
    for (const ratio of [0, 0.13, 0.25, 0.5, 0.62, 0.87, 1]) {
      const point = pointAtRatio(L_SHAPE, ratio);
      expect(nearestRatio(L_SHAPE, point).ratio).toBeCloseTo(ratio, 6);
    }
  });

  it('垂足投影：不在折线上的点也落在连线上，且给出真实距离', () => {
    const hit = nearestRatio(L_SHAPE, { x: 40, y: 30 });
    expect(hit.point).toEqual({ x: 40, y: 0 });
    expect(hit.distance).toBeCloseTo(30, 6);
    expect(hit.ratio).toBeCloseTo(0.2, 6);
  });

  it('投影到第二段时比例继续累积（分段比例不是段内比例）', () => {
    const hit = nearestRatio(L_SHAPE, { x: 130, y: 150 });
    expect(hit.point).toEqual({ x: 100, y: 100 });
    expect(hit.ratio).toBeCloseTo(1, 6);

    const mid = nearestRatio(L_SHAPE, { x: 160, y: 50 });
    expect(mid.point).toEqual({ x: 100, y: 50 });
    expect(mid.ratio).toBeCloseTo(0.75, 6);
  });

  it('退化输入不产生 NaN：空折线、单点、重合点', () => {
    expect(pointAtRatio([], 0.5)).toEqual({ x: 0, y: 0 });
    expect(pointAtRatio([{ x: 7, y: 9 }], 0.5)).toEqual({ x: 7, y: 9 });
    expect(nearestRatio([{ x: 7, y: 9 }], { x: 8, y: 9 }).ratio).toBe(0);
    const zeroLength = polylineLength([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
    expect(zeroLength).toBe(0);
    const single = nearestRatio(
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
      { x: 9, y: 5 },
    );
    expect(Number.isFinite(single.ratio)).toBe(true);
    expect(single.distance).toBeCloseTo(4, 6);
  });
});
