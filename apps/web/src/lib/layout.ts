/**
 * 分栏比例（纯函数，FR-60）
 *
 * 右侧栏「检查器 / 连通性诊断」的分割条拖动时，要保证两块都留得下内容 ——
 * 于是比例不是一个自由的 0–1，而是被**像素下限**夹住的区间。
 * 把它写成纯函数，是为了能直接断言"极端拖动不会把某一块压没"。
 */

/** 每一块的最小高度（像素）：低于这个高度面板里连一行都显示不全 */
export const MIN_PANE_PX = 132;

export interface PaneRatioOptions {
  minPx?: number;
  /** 容器总高度（像素）；未知（0）时按 `fallback` 走 */
  containerPx: number;
  fallback?: number;
}

/** 把任意输入夹到"两块都放得下"的比例区间；容器太矮时退化为各占一半 */
export function clampPaneRatio(ratio: number, options: PaneRatioOptions): number {
  const { containerPx, minPx = MIN_PANE_PX, fallback = 0.46 } = options;
  if (!Number.isFinite(ratio)) return fallback;
  if (!Number.isFinite(containerPx) || containerPx <= 0) return fallback;
  // 两块的最小高度之和都放不下：只能各占一半（拖动没有意义，但也不会算出负数）
  if (containerPx < minPx * 2) return 0.5;
  const min = minPx / containerPx;
  const max = 1 - min;
  return Math.max(min, Math.min(max, ratio));
}

/** 鼠标在容器内的相对位置 → 比例（分割条跟手） */
export function ratioFromPointer(pointerY: number, containerTop: number, containerPx: number): number {
  if (containerPx <= 0) return 0.5;
  return (pointerY - containerTop) / containerPx;
}
