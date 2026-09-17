/**
 * 侧栏卡片布局单测（FR-69 / FR-70）
 *
 * 拖拽最容易出的错都不是"崩溃"，而是**差一格**、**越界**、**拖没了**：
 *  · 在同一列表里向下拖时，插入位按"移除前"的下标算，就会永远少走一格；
 *  · 侧栏宽度不夹取，窗口一窄就把画布挤成 0；
 *  · 存档被改坏（重复 id / 未知 id / 负数宽度）时，面板整块消失。
 * 这些都能用纯函数钉死，所以这里逐条断言行为，而不是断言实现。
 */

import { describe, expect, it } from 'vitest';
import {
  CARD_IDS,
  DEFAULT_LEFT_W,
  DEFAULT_RIGHT_W,
  DEFAULT_RIGHT_WEIGHTS,
  LEGACY_SPLIT_KEY,
  LAYOUT_STORAGE_KEY,
  MIN_CANVAS_W,
  MIN_PANE_PX,
  SIDEBAR_MAX_W,
  SIDEBAR_MIN_W,
  clampSidebarWidth,
  defaultLayout,
  insertionIndex,
  moveCardIds,
  normalizeLayout,
  sidebarMaxWidth,
  weightsFromBoundary,
} from '../panels';

describe('卡片顺序调整', () => {
  it('同列表内上移 / 下移各一格（插入位按"移走之后"的下标算）', () => {
    const list = ['a', 'b', 'c'];
    // 把 c 移到最前
    expect(moveCardIds(list, 'c', 0)).toEqual(['c', 'a', 'b']);
    // 把 a 移到中间：移除后是 [b, c]，插到 1 号位 → [b, a, c]
    expect(moveCardIds(list, 'a', 1)).toEqual(['b', 'a', 'c']);
    // 把 a 移到最后：移除后是 [b, c]，插到 2 号位 → [b, c, a]
    expect(moveCardIds(list, 'a', 2)).toEqual(['b', 'c', 'a']);
  });

  it('下标越界与非法值被夹住，且不丢卡片', () => {
    const list = ['a', 'b', 'c'];
    expect(moveCardIds(list, 'a', -5)).toEqual(['a', 'b', 'c']);
    expect(moveCardIds(list, 'a', 99)).toEqual(['b', 'c', 'a']);
    // 小数下标四舍五入（指针算出来的位置不总是整数）
    expect(moveCardIds(list, 'a', 1.4)).toEqual(['b', 'a', 'c']);
    expect(moveCardIds(list, 'zzz', 0)).toEqual(['zzz', 'a', 'b', 'c']);
  });

  it('插入位按卡片中线判断：首卡上方是 0，末卡下方是 n', () => {
    const boxes = [
      { top: 0, height: 100 },
      { top: 100, height: 100 },
      { top: 200, height: 100 },
    ];
    expect(insertionIndex(-10, boxes)).toBe(0);
    expect(insertionIndex(10, boxes)).toBe(0);
    expect(insertionIndex(60, boxes)).toBe(1);
    expect(insertionIndex(160, boxes)).toBe(2);
    expect(insertionIndex(400, boxes)).toBe(3);
    expect(insertionIndex(50, [])).toBe(0);
  });
});

describe('侧栏宽度夹取', () => {
  it('低于下限 / 高于上限都被夹住', () => {
    expect(clampSidebarWidth(10, { windowPx: 1920, oppositePx: 380 })).toBe(SIDEBAR_MIN_W);
    expect(clampSidebarWidth(9999, { windowPx: 1920, oppositePx: 380 })).toBe(SIDEBAR_MAX_W);
    expect(clampSidebarWidth(300, { windowPx: 1920, oppositePx: 380 })).toBe(300);
  });

  it('窗口变窄时，上限跟着收，画布保住下限', () => {
    // 1280 宽、另一侧 380 → 可用 = 1280 - 380 - 360 = 540
    const max = sidebarMaxWidth({ windowPx: 1280, oppositePx: 380 });
    expect(max).toBe(1280 - 380 - MIN_CANVAS_W);
    expect(clampSidebarWidth(520, { windowPx: 1280, oppositePx: 380 })).toBe(520);
    expect(clampSidebarWidth(600, { windowPx: 1280, oppositePx: 380 })).toBe(max);
    // 极窄窗口：合法区间为空时退化为下限（宁可挤画布，也不能让侧栏消失）
    expect(clampSidebarWidth(400, { windowPx: 500, oppositePx: 380 })).toBe(SIDEBAR_MIN_W);
  });

  it('窗口宽度未知（服务端 / 单测环境）时只做固定上下限夹取', () => {
    expect(clampSidebarWidth(300, { windowPx: 0, oppositePx: 0 })).toBe(300);
    expect(clampSidebarWidth(Number.NaN, { windowPx: 0, oppositePx: 0 })).toBe(SIDEBAR_MIN_W);
  });
});

describe('上下两块的高度比例（FR-60 的推广）', () => {
  it('边界跟手：拖到区域 1/4 处 → 上面那块拿 1/4 的权重', () => {
    // 区域 800px：拖到 200px 处 → 上面那块占 1/4
    const [above, below] = weightsFromBoundary([1, 1], { regionPx: 800, pointerOffsetPx: 200 });
    expect(above).toBeCloseTo(0.5, 6);
    expect(below).toBeCloseTo(1.5, 6);
    // 权重之和守恒（总高度不变）
    expect(above + below).toBeCloseTo(2, 6);
  });

  it('两块都保住最小高度：拖到顶部 / 底部也压不没', () => {
    const region = 400;
    const top = weightsFromBoundary([1, 1], { regionPx: region, pointerOffsetPx: 0 });
    const bottom = weightsFromBoundary([1, 1], { regionPx: region, pointerOffsetPx: 9999 });
    const shareOf = (pair: [number, number]) => pair[0] / (pair[0] + pair[1]);
    expect(shareOf(top) * region).toBeCloseTo(MIN_PANE_PX, 0);
    expect((1 - shareOf(bottom)) * region).toBeCloseTo(MIN_PANE_PX, 0);
  });

  it('非法输入（区域为 0、权重为 0）原样返回，不产生 NaN', () => {
    expect(weightsFromBoundary([1, 1], { regionPx: 0, pointerOffsetPx: 10 })).toEqual([1, 1]);
    expect(weightsFromBoundary([0, 0], { regionPx: 400, pointerOffsetPx: 10 })).toEqual([0, 0]);
  });
});

describe('布局读写与容错', () => {
  it('默认布局：卡片按登记表归位，宽度取当前界面的实测值，节点树默认折叠', () => {
    const layout = defaultLayout();
    expect(layout.collapsed).toEqual({ tree: true });
    expect(layout.leftWidth).toBe(DEFAULT_LEFT_W);
    expect(layout.rightWidth).toBe(DEFAULT_RIGHT_W);
    expect(layout.weights).toEqual(DEFAULT_RIGHT_WEIGHTS);
    expect([...layout.left, ...layout.right].sort()).toEqual([...CARD_IDS].sort());
    expect(layout.left).toContain('tree');
    expect(layout.right).toEqual(['inspector', 'diagnostics']);
  });

  it('坏存档被整理成合法布局：不重复、不丢失、不出现未知卡片', () => {
    const layout = normalizeLayout({
      left: ['tree', 'tree', 'nope', 42],
      right: ['diagnostics'],
      collapsed: { tree: true, nope: true, inspector: false },
      weights: { inspector: 3, nope: 9, diagnostics: -1 },
      leftWidth: -50,
      rightWidth: 'wide',
    });
    expect(layout.left).toEqual(['tree', ...DEFAULT_CARDS_LEFT_REST()]);
    expect(layout.right).toEqual(['diagnostics', 'inspector']);
    expect(layout.collapsed).toEqual({ tree: true });
    // 非法权重被忽略、合法权重保留
    expect(layout.weights['inspector']).toBe(3);
    expect(layout.weights['diagnostics']).toBe(DEFAULT_RIGHT_WEIGHTS['diagnostics']);
    expect(layout.leftWidth).toBe(-50); // 负数留给渲染时的夹取处理（读取时不悄悄改用户数据）
    expect(layout.rightWidth).toBe(DEFAULT_RIGHT_W);
    expect([...layout.left, ...layout.right].sort()).toEqual([...CARD_IDS].sort());
  });

  it('折叠状态以存档为准：用户展开过节点树就不会被默认值摁回去', () => {
    expect(normalizeLayout({ collapsed: {} }).collapsed).toEqual({});
    expect(normalizeLayout({ collapsed: { diagnostics: true } }).collapsed).toEqual({
      diagnostics: true,
    });
    // 存档里完全没有 collapsed 这一项（老存档 / 手写文件）→ 用默认值
    expect(normalizeLayout({ left: [], right: [] }).collapsed).toEqual({ tree: true });
  });

  it('跨栏移动过的卡片不会被"补回默认那一侧"', () => {
    const layout = normalizeLayout({ left: ['tree', 'palette:routing'], right: [] });
    expect(layout.left).toContain('tree');
    expect(layout.left).toContain('palette:routing');
    expect([...layout.left, ...layout.right].sort()).toEqual([...CARD_IDS].sort());
  });

  it('没有新存档时，用 FR-60 时代的分割比例还原两块权重', () => {
    const layout = normalizeLayout(null, 0.3);
    expect(layout.weights['inspector']).toBeCloseTo(0.3, 6);
    expect(layout.weights['diagnostics']).toBeCloseTo(0.7, 6);
  });

  it('存储键是稳定的（改键名等于丢掉所有人的布局）', () => {
    expect(LAYOUT_STORAGE_KEY).toBe('toposmith.ui.layout.v1');
    expect(LEGACY_SPLIT_KEY).toBe('toposmith.ui.sidebarSplit');
  });
});

/** 默认布局里除 tree 之外的左侧卡片（断言补全顺序时用，避免把顺序写死在测试里） */
function DEFAULT_CARDS_LEFT_REST(): string[] {
  const layout = defaultLayout();
  return layout.left.filter((id) => id !== 'tree');
}
