/**
 * "适应视图"的算法（纯函数，FR-51）
 *
 * 旧实现有三个问题，全部来自"把屏幕尺寸写死成常量"：
 *  1. 用 `1200 / 宽` 与 `700 / 高` 算缩放 —— 真实的画布尺寸根本没参与，
 *     宽屏上于是留下大片空白，窄窗口里又装不下；
 *  2. 留白是加在**世界坐标**上的固定 80/60，缩放一变，屏幕上的留白就跟着变，
 *     小拓扑（两台设备）会被这点留白顶得只剩中间一小块；
 *  3. 缩放上下限写死 [0.3, 1.6]，大拓扑被 0.3 卡住 → 内容溢出视口。
 *
 * 新实现：**留白用屏幕像素**（与缩放无关），缩放同时受"装得下"与"别放太大"约束，
 * 再把内容**居中**。于是"完整装进可视区域"与"不留过多空白"同时成立。
 */

import type { World } from '@toposmith/engine';
import { boxesBounds, hitRect, type Box } from './geometry';
import { linkPath } from './link-path';
import { boundsOfPoints } from './polyline';

export interface FitBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface ViewportLike {
  x: number;
  y: number;
  k: number;
}

/** 视口四周留白（屏幕像素）：小一点，避免"装下了但四周空荡荡" */
export const FIT_PADDING_PX = 28;
/**
 * **交互缩放**的上下限（滚轮 / 工具栏按钮）。
 *
 * 下限从 25% 降到 5%：25% 时中型 IDC 那种图（适应视图需要 13%）根本缩不到全景，
 * 用户会以为"这图看不全"。既然适应视图能算到 13%，手动缩放没有理由挡在 25%。
 */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;

/**
 * 适应视图的缩放上限：内容很小（一两台设备）时不无限放大 ——
 * 放太大反而看不出"这是一张拓扑"。
 */
export const FIT_MAX_ZOOM = 2;

/**
 * 适应视图的缩放**下限只做数值兜底**（0.02），不套用交互滚轮的缩放下限。
 *
 * 这是刻意的："装得下"与"别缩太小"冲突时，**前者优先** ——
 * 一百台设备的拓扑就该缩到 0.05 才能一眼看全，用户想看清细节自己会放大。
 * 旧实现把 0.3 当下限，于是大拓扑永远溢出视口，这正是用户反馈的"算法有问题"。
 */
export const FIT_MIN_ZOOM = 0.02;

/** 内容为空/退化时的默认缩放 */
export const FIT_FALLBACK_ZOOM = 1;

export function clampZoom(k: number): number {
  if (!Number.isFinite(k) || k <= 0) return FIT_FALLBACK_ZOOM;
  return Math.max(FIT_MIN_ZOOM, Math.min(FIT_MAX_ZOOM, k));
}

/**
 * 计算"把 bounds 装进 size"的视口。
 *
 * 数学：世界点 p 的屏幕位置是 `p * k + viewport`，所以让内容区块居中即
 *   `viewport.x = (W - bounds.w * k) / 2 - bounds.x * k`
 * 缩放取"宽高两个方向都装得下"的较小值。
 */
export function computeFit(
  bounds: FitBounds,
  size: Size,
  padding = FIT_PADDING_PX,
): ViewportLike {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const availableW = Math.max(1, width - padding * 2);
  const availableH = Math.max(1, height - padding * 2);

  // 退化情形：没有内容（或内容尺寸为 0）→ 不动缩放，只给左上角留白
  const w = Math.max(0, bounds.w);
  const h = Math.max(0, bounds.h);
  if (w <= 0 || h <= 0) {
    const k = FIT_FALLBACK_ZOOM;
    return { x: padding - bounds.x * k, y: padding - bounds.y * k, k };
  }

  const k = clampZoom(Math.min(availableW / w, availableH / h));
  return {
    x: (width - w * k) / 2 - bounds.x * k,
    y: (height - h * k) / 2 - bounds.y * k,
    k,
  };
}

/** 内容区块在屏幕上的矩形（供"是否真的装下了"这类断言使用） */
export function projectedBounds(bounds: FitBounds, viewport: ViewportLike): FitBounds {
  return {
    x: bounds.x * viewport.k + viewport.x,
    y: bounds.y * viewport.k + viewport.y,
    w: bounds.w * viewport.k,
    h: bounds.h * viewport.k,
  };
}

/**
 * 画布上"可见内容"的总范围：**设备卡片 ∪ 连线的折线**。
 *
 * 为什么必须包含连线：电缆会垂到卡片下方、标签压在线上，
 * 只按卡片算范围，"适应视图"就会把线尾和标签切在视口外。
 * 折线取的是 `linkPath`（与画布上画的同一条），所以范围与观感一致。
 */
export function worldContentBounds(world: World): FitBounds | null {
  const boxes: Box[] = world.ordered.map((device) => hitRect(device));
  for (const link of world.links) {
    const path = linkPath(world, link);
    if (path) boxes.push(boundsOfPoints(path.points));
  }
  return boxesBounds(boxes);
}
