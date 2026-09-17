/** 适应视图算法单测（FR-51） */

import { describe, expect, it } from 'vitest';
import {
  FIT_MAX_ZOOM,
  FIT_MIN_ZOOM,
  FIT_PADDING_PX,
  computeFit,
  projectedBounds,
  type FitBounds,
} from '../fit';

const SIZE = { width: 1000, height: 600 };

/** 断言：内容完整落在视口内，且四周留白不超过 padding（即"没有过多空白"） */
function expectFits(bounds: FitBounds, size = SIZE, padding = FIT_PADDING_PX) {
  const viewport = computeFit(bounds, size, padding);
  const projected = projectedBounds(bounds, viewport);
  expect(projected.x).toBeGreaterThanOrEqual(-0.001);
  expect(projected.y).toBeGreaterThanOrEqual(-0.001);
  expect(projected.x + projected.w).toBeLessThanOrEqual(size.width + 0.001);
  expect(projected.y + projected.h).toBeLessThanOrEqual(size.height + 0.001);
  // 被约束的那一轴必须几乎铺满（留白不超过 padding + 1px 取整误差）
  const slackX = size.width - projected.w;
  const slackY = size.height - projected.h;
  expect(Math.min(slackX, slackY)).toBeLessThanOrEqual(padding * 2 + 1.001);
  return { viewport, projected };
}

describe('适应视图', () => {
  it('宽扁拓扑：横向铺满、纵向居中', () => {
    const { projected } = expectFits({ x: 0, y: 0, w: 2000, h: 200 });
    const centerY = projected.y + projected.h / 2;
    expect(centerY).toBeCloseTo(SIZE.height / 2, 6);
  });

  it('高瘦拓扑：纵向铺满、横向居中', () => {
    const { projected } = expectFits({ x: 0, y: 0, w: 200, h: 2000 });
    const centerX = projected.x + projected.w / 2;
    expect(centerX).toBeCloseTo(SIZE.width / 2, 6);
  });

  it('小拓扑（两台设备）：装得下但不会放到超出上限', () => {
    const bounds = { x: 700, y: 300, w: 400, h: 90 };
    const viewport = computeFit(bounds, SIZE);
    expect(viewport.k).toBeLessThanOrEqual(FIT_MAX_ZOOM);
    // 与旧实现对照：旧算法无论如何都会把内容缩到 1.6 倍以内却把留白算成世界坐标，
    // 这里小内容要么放大到上限、要么铺满，不能"缩在中间一小块"
    const projected = projectedBounds(bounds, viewport);
    expect(projected.w).toBeGreaterThan(SIZE.width * 0.3);
  });

  it('很大的拓扑：允许缩到比交互下限更小，从而真的装得下（旧实现会溢出）', () => {
    const bounds = { x: -5000, y: -4000, w: 20000, h: 12000 };
    const { viewport } = expectFits(bounds);
    // 1000×600 视口装下 20000 宽的内容需要 k ≈ 0.048
    expect(viewport.k).toBeLessThan(0.06);
    expect(viewport.k).toBeGreaterThanOrEqual(FIT_MIN_ZOOM);
  });

  it('内容位置不影响"装得下"（负坐标同样正确）', () => {
    expectFits({ x: -3000, y: -2000, w: 1200, h: 800 });
    expectFits({ x: 9000, y: 7000, w: 1200, h: 800 });
  });

  it('画布尺寸真的参与计算（宽屏与窄窗得到不同缩放）', () => {
    const bounds = { x: 0, y: 0, w: 1000, h: 500 };
    const wide = computeFit(bounds, { width: 2000, height: 600 });
    const narrow = computeFit(bounds, { width: 700, height: 600 });
    expect(wide.k).toBeGreaterThan(narrow.k);
    // 固定常量 1200×700 的旧算法对这两种视口会给出**相同**结果
    expect(wide.k).not.toBeCloseTo(narrow.k, 3);
  });

  it('退化输入不产生 NaN：空内容、零尺寸、零画布', () => {
    const empty = computeFit({ x: 120, y: 80, w: 0, h: 0 }, SIZE);
    expect(Number.isFinite(empty.x)).toBe(true);
    expect(Number.isFinite(empty.y)).toBe(true);
    expect(empty.k).toBeGreaterThan(0);
    const zero = computeFit({ x: 0, y: 0, w: 100, h: 100 }, { width: 0, height: 0 });
    expect(Number.isFinite(zero.x)).toBe(true);
    expect(zero.k).toBeGreaterThan(0);
  });

  it('留白可调：padding 变大时被约束轴仍按新留白铺满', () => {
    const bounds = { x: 0, y: 0, w: 3000, h: 400 };
    const padded = computeFit(bounds, SIZE, 80);
    const projected = projectedBounds(bounds, padded);
    expect(SIZE.width - projected.w).toBeCloseTo(160, 1);
  });
});
