/** 分栏比例单测（FR-60） */

import { describe, expect, it } from 'vitest';
import { MIN_PANE_PX, clampPaneRatio, ratioFromPointer } from '../layout';

const H = 800;

describe('分栏比例', () => {
  it('正常区间内原样通过', () => {
    expect(clampPaneRatio(0.5, { containerPx: H })).toBeCloseTo(0.5, 6);
    expect(clampPaneRatio(0.3, { containerPx: H })).toBeCloseTo(0.3, 6);
  });

  it('拖到极端也不会把某一块压没（各自至少留最小高度）', () => {
    const top = clampPaneRatio(-2, { containerPx: H });
    const bottom = clampPaneRatio(9, { containerPx: H });
    expect(top * H).toBeGreaterThanOrEqual(MIN_PANE_PX - 0.001);
    expect((1 - bottom) * H).toBeGreaterThanOrEqual(MIN_PANE_PX - 0.001);
  });

  it('容器太矮（两块最小高度之和都放不下）→ 各占一半', () => {
    expect(clampPaneRatio(0.9, { containerPx: MIN_PANE_PX * 2 - 40 })).toBe(0.5);
  });

  it('退化输入不产生 NaN', () => {
    expect(clampPaneRatio(Number.NaN, { containerPx: H })).toBeCloseTo(0.46, 6);
    expect(clampPaneRatio(0.4, { containerPx: 0 })).toBeCloseTo(0.46, 6);
    expect(Number.isFinite(clampPaneRatio(0.4, { containerPx: -100 }))).toBe(true);
  });

  it('指针位置换算比例；容器高度为 0 时退化为一半', () => {
    expect(ratioFromPointer(500, 100, H)).toBeCloseTo(0.5, 6);
    expect(ratioFromPointer(300, 100, 0)).toBe(0.5);
  });
});
