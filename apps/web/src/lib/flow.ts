/**
 * 链路流向动画的几何与速度模型（纯函数，可单元测试）
 *
 * 设计要点：
 *  1. 动画的**速度**必须来自链路真实速率，而不是统一的匀速飘动 ——
 *     否则"通讯速度"这类诊断的动画就在骗人。100M 与 10G 的视觉速度差约 3 倍
 *     （对数刻度：肉眼能分辨，又不会让 10G 快到看不见）。
 *  2. 诊断失败时粒子**停在阻断点**并保持不动，配合红色脉冲指出"数据到此为止"。
 *  3. 动画只在 UI 层存在：不参与推演，不影响任何结论。
 */

import type { Hop } from '@toposmith/engine';

export interface FlowPoint {
  x: number;
  y: number;
}

export type FlowFamily = 'copper' | 'fiber' | 'wireless';

/** 一段有向链路（沿数据流方向）；用折线表示，以支持弯曲的电缆路径 */
export interface FlowSegmentSource {
  /** 至少两个点，首点为起点、末点为终点 */
  points: FlowPoint[];
  speedMbps: number;
  family: FlowFamily;
}

export interface FlowResolver {
  /** 设备中心的画布世界坐标 */
  center: (deviceId: string) => FlowPoint | undefined;
  /**
   * 该跳在二层**实际经过**的线段序列（含中间交换机两侧的链路）。
   * 取自 `hop.transitLinkIds`；拿不到时返回空数组，调用方会退回静态高亮。
   */
  segmentsForHop: (hop: Hop) => FlowSegmentSource[];
}

export interface FlowSegment {
  /** 弧长起止 */
  start: number;
  end: number;
  speedMbps: number;
  family: FlowFamily;
  hopIndex: number;
}

export interface FlowPath {
  points: FlowPoint[];
  /** 总弧长（世界单位） */
  total: number;
  segments: FlowSegment[];
  /** 每一跳到达时的弧长，用于逐跳高亮 */
  hopMarks: { hopIndex: number; at: number }[];
  /** 失败时粒子停在此弧长；成功为 null（循环流动） */
  stopAt: number | null;
  minSpeedMbps: number;
  maxSpeedMbps: number;
  kind: 'ok' | 'failed';
}

/** 基准视觉速度（世界单位/秒），对应 100 Mbps */
export const FLOW_BASE_SPEED = 55;
/** 粒子间距（世界单位） */
export const FLOW_PARTICLE_GAP = 92;

/** 链路速率 → 视觉速度：对数刻度，100M ≈ 55、1G ≈ 110、10G ≈ 165 */
export function visualSpeedForLink(speedMbps: number): number {
  const mbit = Math.max(100, speedMbps);
  return FLOW_BASE_SPEED * (1 + Math.log10(mbit / 100));
}

function distanceBetween(a: FlowPoint, b: FlowPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 依据诊断结果的逐跳路径构建动画折线。
 *
 * 返回 null 表示"这条结果没有可动画的空间路径"（例如 DNS 解析链、
 * 或路径上缺少几何信息），调用方应安静地退回静态高亮。
 */
export function buildFlowPath(hops: Hop[], resolver: FlowResolver, ok: boolean): FlowPath | null {
  if (hops.length === 0) return null;

  const first = resolver.center(hops[0]!.deviceId);
  if (!first) return null;
  const points: FlowPoint[] = [first];
  const segments: FlowSegment[] = [];
  const hopMarks: { hopIndex: number; at: number }[] = [{ hopIndex: hops[0]!.index, at: 0 }];
  let total = 0;
  let minSpeed = Number.POSITIVE_INFINITY;
  let maxSpeed = 0;

  for (const hop of hops) {
    const hopSegments = resolver.segmentsForHop(hop);
    if (hopSegments.length === 0) continue;

    for (const source of hopSegments) {
      const sourcePoints = source.points;
      if (sourcePoints.length < 2) continue;

      // 与上一段不连续时补一条连接线（视觉上穿过设备内部）
      const connector = distanceBetween(points[points.length - 1]!, sourcePoints[0]!);
      if (connector > 0.5) {
        segments.push({
          start: total,
          end: total + connector,
          speedMbps: source.speedMbps,
          family: source.family,
          hopIndex: hop.index,
        });
        total += connector;
        points.push(sourcePoints[0]!);
      }

      for (let i = 0; i + 1 < sourcePoints.length; i += 1) {
        const from = sourcePoints[i]!;
        const to = sourcePoints[i + 1]!;
        const segmentLength = distanceBetween(from, to);
        if (segmentLength <= 0.01) continue;
        segments.push({
          start: total,
          end: total + segmentLength,
          speedMbps: source.speedMbps,
          family: source.family,
          hopIndex: hop.index,
        });
        total += segmentLength;
        points.push(to);
      }

      minSpeed = Math.min(minSpeed, source.speedMbps);
      maxSpeed = Math.max(maxSpeed, source.speedMbps);
    }

    hopMarks.push({ hopIndex: hop.index, at: total });
  }

  if (segments.length === 0 || total <= 1) return null;

  // 收尾：把终点设备中心接上，让粒子"进入"目标设备而不是停在机箱边框
  const lastHop = hops[hops.length - 1]!;
  const lastCenter = resolver.center(lastHop.deviceId);
  const tail = points[points.length - 1]!;
  if (lastCenter && distanceBetween(tail, lastCenter) > 1) {
    const tailLength = distanceBetween(tail, lastCenter);
    const lastSpeed = segments[segments.length - 1]!.speedMbps;
    segments.push({
      start: total,
      end: total + tailLength,
      speedMbps: lastSpeed,
      family: segments[segments.length - 1]!.family,
      hopIndex: lastHop.index,
    });
    total += tailLength;
    points.push(lastCenter);
  }

  return {
    points,
    total,
    segments,
    hopMarks,
    stopAt: ok ? null : total,
    minSpeedMbps: Number.isFinite(minSpeed) ? minSpeed : 0,
    maxSpeedMbps: maxSpeed,
    kind: ok ? 'ok' : 'failed',
  };
}

export function segmentAt(path: FlowPath, distance: number): FlowSegment | null {
  const d = Math.max(0, Math.min(distance, path.total));
  for (const segment of path.segments) {
    if (d >= segment.start && d <= segment.end) return segment;
  }
  return path.segments[path.segments.length - 1] ?? null;
}

/** 当前弧长处的视觉速度（世界单位/秒） */
export function speedAt(path: FlowPath, distance: number): number {
  const segment = segmentAt(path, distance);
  if (!segment) return FLOW_BASE_SPEED;
  return visualSpeedForLink(segment.speedMbps);
}

/** 当前弧长落在第几跳上（用于逐跳高亮与"第 N 跳"提示） */
export function hopIndexAt(path: FlowPath, distance: number): number {
  const segment = segmentAt(path, distance);
  return segment?.hopIndex ?? 0;
}

/**
 * 推进一个粒子的弧长。
 *
 * - 成功路径：越过终点后回绕，形成持续流动
 * - 失败路径：停在阻断点（stopAt），由 UI 用红色脉冲指出"到此为止"
 */
export function advanceDistance(
  path: FlowPath,
  distance: number,
  dtSeconds: number,
  rate = 1,
): number {
  if (path.stopAt !== null) {
    return Math.min(distance + speedAt(path, distance) * dtSeconds * rate, path.stopAt);
  }
  let next = distance + speedAt(path, distance) * dtSeconds * rate;
  if (next > path.total) next -= path.total;
  return next;
}

/** 粒子是否已抵达阻断点 */
export function isStopped(path: FlowPath, distance: number, epsilon = 0.75): boolean {
  return path.stopAt !== null && distance >= path.stopAt - epsilon;
}

/** 弯曲折线上的插值取点 */
export function pointAt(path: FlowPath, distance: number): FlowPoint {
  const d = Math.max(0, Math.min(distance, path.total));
  let walked = 0;
  for (let i = 0; i + 1 < path.points.length; i += 1) {
    const a = path.points[i]!;
    const b = path.points[i + 1]!;
    const length = distanceBetween(a, b);
    if (walked + length >= d) {
      const t = length === 0 ? 0 : (d - walked) / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += length;
  }
  return path.points[path.points.length - 1] ?? { x: 0, y: 0 };
}

/** 初始粒子分布：按间距铺满整条路径 */
export function initialDistances(path: FlowPath): number[] {
  const count = Math.max(2, Math.min(14, Math.round(path.total / FLOW_PARTICLE_GAP)));
  const step = path.total / count;
  return Array.from({ length: count }, (_, index) => index * step);
}
