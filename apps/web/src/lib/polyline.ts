/**
 * 折线的弧长参数化（纯函数，FR-46）
 *
 * 连线标签要"沿连线拖动"，就需要在折线上做两件互逆的事：
 *  1. 由**点**反推**位置**（`nearestRatio`）—— 拖拽时把光标投影到连线上；
 *  2. 由**位置**取回**点**（`pointAtRatio`）—— 绘制标签与算命中框时用。
 *
 * 位置参数用**弧长比例**（0 = A 端端口，1 = B 端端口），而不是"第几个采样点"：
 * 采样点密度是绘制细节（曲线细分），一旦调整细分，按下标存的标签就会跳位置；
 * 弧长比例对细分、缩放、设备移动都是稳定的（D-36）。
 */

import type { Point } from './geometry';

export interface PolylineProjection {
  /** 弧长比例 0–1 */
  ratio: number;
  /** 折线上的垂足 */
  point: Point;
  /** 光标到折线的距离（世界单位） */
  distance: number;
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * 折线的包围盒（世界坐标）。
 *
 * "适应视图"要把电缆也算进内容范围（电缆垂在卡片下方），
 * 而电缆在数据里只是一串采样点 —— 所以需要一个点集的包围盒。
 */
export function boundsOfPoints(points: Point[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const first = points[0];
  if (!first) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 折线总长 */
export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    total += distanceBetween(points[i] as Point, points[i + 1] as Point);
  }
  return total;
}

/** 按弧长比例取点；越界自动钳制到两端 */
export function pointAtRatio(points: Point[], ratio: number): Point {
  const first = points[0];
  if (!first) return { x: 0, y: 0 };
  if (points.length === 1) return { ...first };

  const target = polylineLength(points) * clamp01(ratio);
  let walked = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    const length = distanceBetween(a, b);
    if (walked + length >= target) {
      const t = length === 0 ? 0 : (target - walked) / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += length;
  }
  const last = points[points.length - 1] as Point;
  return { ...last };
}

/**
 * 把任意点投影到折线上，返回最接近的弧长比例。
 *
 * 逐段求垂足（而不是"取最近的采样点"）：采样点间距在长连线上可达十几像素，
 * 取最近点会让标签在拖动时一跳一跳。
 */
export function nearestRatio(points: Point[], at: Point): PolylineProjection {
  const first = points[0];
  if (!first) return { ratio: 0, point: { x: 0, y: 0 }, distance: Number.POSITIVE_INFINITY };
  if (points.length === 1) {
    return { ratio: 0, point: { ...first }, distance: distanceBetween(first, at) };
  }

  const total = polylineLength(points);
  const safeTotal = total === 0 ? 1 : total;

  let walked = 0;
  let best: PolylineProjection = {
    ratio: 0,
    point: { ...first },
    distance: Number.POSITIVE_INFINITY,
  };

  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const length = Math.sqrt(lengthSq);
    const t = lengthSq === 0 ? 0 : clamp01(((at.x - a.x) * dx + (at.y - a.y) * dy) / lengthSq);
    const foot = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = distanceBetween(foot, at);
    if (distance < best.distance) {
      best = { ratio: (walked + length * t) / safeTotal, point: foot, distance };
    }
    walked += length;
  }

  return { ...best, ratio: clamp01(best.ratio) };
}
