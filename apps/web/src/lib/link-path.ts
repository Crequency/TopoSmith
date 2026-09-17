/**
 * 连线路由（纯函数）
 *
 * 从 `render/draw.ts` 里搬出来的：**"电缆长什么样"是几何，不是绘制**。
 * 搬出来之后 store（适应视图要算连线的包围盒）与 Canvas（每帧算连线中点来驱动摆动）
 * 都能用它，而不必让状态层反过来依赖渲染层。
 */

import type { DerivedLink, World } from '@toposmith/engine';
import { clampLabelRatio, DEFAULT_LABEL_RATIO } from '@toposmith/schema';
import { NODE_H, NODE_W, cardHeightOf, cardWidthOf, type CardSized, type Point } from './geometry';
import { portGlyphOf } from './ports';
import { pointAtRatio } from './polyline';

export interface CablePath {
  /** 从起点端口到终点端口的折线（世界坐标） */
  points: Point[];
  /** 端口与卡片的接入点（卡片底边） */
  from: Point;
  to: Point;
  /** 几何中点（弧长 50%）—— 标签默认落在这里，也是"吸附回中点"的参照 */
  mid: Point;
  /** 标签的**实际**位置：由 `Cable.labelRatio` 决定（FR-46，可被拖拽移动） */
  labelPoint: Point;
}

/**
 * 电缆的摆动偏移（世界单位）；由 `lib/cable-physics` 逐帧算出（FR-50）。
 *
 * 这里只声明**绘制需要的那两个分量**：物理状态（含速度）是它的超集，
 * 于是"物理模块 → 几何模块"不必反向依赖，绘制层也不必知道弹簧参数。
 */
export interface CableSwayOffset {
  x: number;
  y: number;
}

function bottomCenter(device: CardSized & { x: number; y: number }): Point {
  return { x: device.x + cardWidthOf(device) / 2, y: device.y + cardHeightOf(device) };
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point, steps: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    points.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
  return points;
}

/** 电缆的下垂幅度：跨度越大垂得越多，但有上下限（太短的线不该垂成一个环） */
export function cableDropFor(span: number): number {
  return Math.min(140, Math.max(26, span * 0.34));
}

/**
 * 连线路由：从 A 端口图元的接入点出发，向下垂一段后弯到 B 端口接入点。
 *
 * 这条曲线是"电缆"的视觉隐喻，也让连线**明确从端口出发**而不是从卡片中心出发
 * （FR-33）。端口图元与卡片底边之间的那一小段由 `drawPortTail` 在卡片上层补上，
 * 于是视觉上"电缆插在端口里"。
 *
 * `sway` 是拖拽时的物理摆动偏移（FR-50）：两个控制点一起平移 `sway`，
 * **两端接入点不动** —— 曲线中段位移约 0.75×|sway|，于是看起来像"电缆被拽着甩"，
 * 而不是"整根线跟着卡片平移"。
 */
export function linkPath(world: World, link: DerivedLink, sway?: CableSwayOffset): CablePath | null {
  const deviceA = world.devices.get(link.a.deviceId);
  const deviceB = world.devices.get(link.b.deviceId);
  if (!deviceA || !deviceB) return null;

  const glyphA = portGlyphOf(deviceA, link.a.portId);
  const glyphB = portGlyphOf(deviceB, link.b.portId);
  const from = glyphA ? { x: glyphA.centerX, y: glyphA.anchorY } : bottomCenter(deviceA);
  const to = glyphB ? { x: glyphB.centerX, y: glyphB.anchorY } : bottomCenter(deviceB);

  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const drop = cableDropFor(span);
  const ox = sway?.x ?? 0;
  const oy = sway?.y ?? 0;
  const points = sampleCubic(
    from,
    { x: from.x + ox, y: from.y + drop + oy },
    { x: to.x + ox, y: to.y + drop + oy },
    to,
    18,
  );
  return {
    points,
    from,
    to,
    mid: pointAtRatio(points, DEFAULT_LABEL_RATIO),
    labelPoint: pointAtRatio(points, clampLabelRatio(link.cable.labelRatio)),
  };
}

/** 连线在**没有摆动**时的锚点中点：物理模拟用它来算"端点这一帧移动了多少" */
export function linkAnchorMidpoint(world: World, link: DerivedLink): Point | null {
  const path = linkPath(world, link);
  if (!path) return null;
  return { x: (path.from.x + path.to.x) / 2, y: (path.from.y + path.to.y) / 2 };
}

/** 连线两端接入点的跨度（用于按线长缩放摆动幅度） */
export function linkSpan(world: World, link: DerivedLink): number {
  const deviceA = world.devices.get(link.a.deviceId);
  const deviceB = world.devices.get(link.b.deviceId);
  if (!deviceA || !deviceB) return NODE_W;
  const path = linkPath(world, link);
  if (!path) return NODE_W;
  return Math.hypot(path.to.x - path.from.x, path.to.y - path.from.y);
}

/** 兜底：极端情况下端口与设备都查不到时的连线跨度 */
export const DEFAULT_LINK_SPAN = NODE_H;
