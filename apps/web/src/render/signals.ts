/**
 * 无线信号波动画（独立覆盖层）
 *
 * 无线关联不再画线，取而代之的是两件事：
 *   · **覆盖圈**说明"能服务到哪"（`draw.ts` 的 drawCoverages）；
 *   · **信号波**说明"这条关联此刻是通的"（本文件）。
 *
 * 为什么单独一层画布：信号波是**常驻动画**。若把它画进主场景，每一帧都要重画
 * 800 条连线与 700 多张卡片（实测主场景一帧十几毫秒），为了几个跳动的点而让
 * 常驻 rAF 烧掉半个核，与"静止时不烧 CPU"的既有约定（FR-50）直接冲突。
 * 覆盖层只有几个圆点和圆弧，一帧不到 0.1 ms，且清空它不需要碰主场景。
 *
 * 这一层是**纯绘制**：相位由调用方推进（`SignalParams.phase`），
 * 因此"降低动效"只要不推进相位即可得到一张静态图 —— 不需要在这里分支。
 */

import { KIND_COLOR } from './draw';
import { linkPath } from '../lib/link-path';
import { coverageView } from '../lib/coverage';
import { pointAtRatio } from '../lib/polyline';
import { worldToScreen } from './draw';
import type { DerivedLink, World } from '@toposmith/anvil';
import type { Point } from '@toposmith/schema';
import type { Viewport } from '../state/store';

export interface SignalParams {
  world: World;
  camera: Viewport;
  width: number;
  height: number;
  /** 动画相位（0–1）。调用方按时间推进；不推进就是静态图 */
  phase: number;
}

/** 沿一条关联流动的信号点个数（3 个足以看出方向，又不会太吵） */
const SIGNAL_DOTS = 3;
/** 信号点半径（屏幕像素） */
const DOT_RADIUS = 2.4;
/** 端点处涟漪的圈数 */
const RIPPLES = 3;
const RIPPLE_BASE_PX = 6;
const RIPPLE_STEP_PX = 7;

/** 需要画信号波的无线关联：覆盖场景下、且当下是通的 */
export function signalLinks(world: World): DerivedLink[] {
  const out: DerivedLink[] = [];
  for (const link of world.links) {
    if (link.family !== 'wireless' || !link.up) continue;
    const a = world.devices.get(link.a.deviceId);
    const b = world.devices.get(link.b.deviceId);
    if ((a && coverageView(a)) || (b && coverageView(b))) out.push(link);
  }
  return out;
}

/** 提供覆盖的那一端（决定信号从哪边发出）；两端都提供时取 a 端 */
function providerEnd(world: World, link: DerivedLink): 'a' | 'b' {
  const a = world.devices.get(link.a.deviceId);
  const b = world.devices.get(link.b.deviceId);
  if (a && coverageView(a)) return 'a';
  if (b && coverageView(b)) return 'b';
  return 'a';
}

function tintOf(world: World, link: DerivedLink): string {
  const provider = providerEnd(world, link) === 'a' ? link.a : link.b;
  const device = world.devices.get(provider.deviceId);
  return device ? (KIND_COLOR[device.kind] ?? '#38bdf8') : '#38bdf8';
}

/**
 * 画一帧信号波。
 *
 * 调用方负责先 `clearRect`：这一层是完全透明的覆盖层，只画信号本身。
 */
export function drawSignals(ctx: CanvasRenderingContext2D, params: SignalParams): number {
  const { world, camera, phase } = params;
  const links = signalLinks(world);
  if (links.length === 0) return 0;
  let drawn = 0;

  // 视口包围盒（多给一圈余量）：整条关联都在屏幕外的直接跳过
  const margin = 80;
  const left = (0 - camera.x) / camera.k - margin;
  const top = (0 - camera.y) / camera.k - margin;
  const right = (params.width - camera.x) / camera.k + margin;
  const bottom = (params.height - camera.y) / camera.k + margin;

  for (const link of links) {
    const path = linkPath(world, link);
    if (!path) continue;
    const bounds = boundsOf(path.points);
    if (bounds.right < left || bounds.left > right || bounds.bottom < top || bounds.top > bottom) {
      continue;
    }

    // 屏幕坐标的折线：弧长在屏幕上均匀，视觉速度才不受缩放影响
    const screen: Point[] = path.points.map((point) => worldToScreen(camera, point.x, point.y));
    const from = providerEnd(world, link) === 'a' ? screen[0] : screen[screen.length - 1];
    const to = providerEnd(world, link) === 'a' ? screen[screen.length - 1] : screen[0];
    if (!from || !to) continue;

    const color = tintOf(world, link);
    drawSignalDots(ctx, screen, color, phase);
    drawRipples(ctx, from, to, color, phase);
    drawRipples(ctx, to, from, color, phase + 0.5);
    drawn += 1;
  }
  return drawn;
}

/** 沿关联流动的信号点：两端淡入淡出，看起来是"在传"而不是"在闪" */
function drawSignalDots(
  ctx: CanvasRenderingContext2D,
  screen: Point[],
  color: string,
  phase: number,
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  for (let i = 0; i < SIGNAL_DOTS; i += 1) {
    const t = (phase + i / SIGNAL_DOTS) % 1;
    const at = pointAtRatio(screen, t);
    ctx.globalAlpha = Math.sin(Math.PI * t) * 0.95;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(at.x, at.y, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 端点处的信号涟漪：几圈朝对端张开的圆弧，向外扩散并淡出。
 *
 * 两端都画是刻意的：信号点可能因为缩放在屏幕外（用户在卡片附近放大时），
 * 只要端点的涟漪在视野里，就仍然能读出"这台设备有无线连接、朝哪边"。
 */
function drawRipples(
  ctx: CanvasRenderingContext2D,
  at: Point,
  toward: Point,
  color: string,
  phase: number,
): void {
  const direction = Math.atan2(toward.y - at.y, toward.x - at.x);
  const spread = 0.55; // 约 63°，像一圈朝外的波前
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (let i = 0; i < RIPPLES; i += 1) {
    const t = (phase + i / RIPPLES) % 1;
    ctx.globalAlpha = (1 - t) * 0.7;
    ctx.beginPath();
    ctx.arc(at.x, at.y, RIPPLE_BASE_PX + t * RIPPLE_STEP_PX, direction - spread, direction + spread);
    ctx.stroke();
  }
  ctx.restore();
}

function boundsOf(points: Point[]): { left: number; top: number; right: number; bottom: number } {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { left, top, right, bottom };
}
