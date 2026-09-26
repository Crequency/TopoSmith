/**
 * 无线动画的**表现形式**实现（FR-86）
 *
 * 九种形态画在同一个覆盖层上（见 `signals.ts`），共用的前提：
 *   · 起点 = 提供方的**卡片中心**，终点 = 对端的**卡片中心**，两者之间是**直线**；
 *   · 全部在**屏幕空间**画（线宽、半径、波长都是像素），缩放时不至于糊成一片；
 *   · 相位由调用方推进（`phase` 0–1），**不推进就是静态图** —— 因此"降低动效"
 *     不需要在这里分支，每种形态在 phase=0 时都必须是可读的一帧。
 *
 * 这里的几何计算都抽成**纯函数**（半径序列、扫描角、波长、六边形顶点……），
 * 于是"涟漪是不是在扩散""高频是不是更密""波束有没有在扫"都能被单测钉住，
 * 而不是靠肉眼看动画。绘制函数只负责把这些数字画出来。
 */

import { KIND_COLOR } from './draw';
import { coverageGeometry, deviceCenter, type WirelessAnimationStyle, type Point } from '@toposmith/schema';
import type { Device } from '@toposmith/schema';
import { worldToScreen } from './draw';
import type { Viewport } from '../state/store';

/** 一个"提供方 + 它的所有对端"：MIMO 波束、涟漪、蜂窝网格都需要看全这一组 */
export interface ProviderGroup {
  deviceId: string;
  device: Device;
  /** 卡片中心（屏幕坐标） */
  center: Point;
  /** 覆盖半径（屏幕像素，可能为 0） */
  coverageRadiusPx: number;
  style: WirelessAnimationStyle;
  tint: string;
  peers: { linkId: string; peerDeviceId: string; device: Device; center: Point; distancePx: number }[];
}

/* ────────────────────────────── 纯几何 ────────────────────────────── */

/**
 * 信号涟漪的半径序列：从设备向外扩散。
 *
 * `phase` 推移时每一圈都向外走，走到 `maxRadius` 就消失（透明度按"离圆心的比例"衰减）。
 * 返回的是**当前这一帧**要画的几圈（含透明度），而不是"一圈一圈生成"，
 * 这样静态图（phase 固定）也能看到几圈同时存在。
 */
export function rippleRings(
  maxRadius: number,
  phase: number,
  count = 4,
): { radius: number; alpha: number }[] {
  const outer = Math.max(12, maxRadius);
  const rings: { radius: number; alpha: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = (((phase + i / count) % 1) + 1) % 1;
    const radius = Math.max(2, t * outer);
    rings.push({ radius, alpha: (1 - t) * 0.75 });
  }
  return rings;
}

/**
 * 波束扫描的**当前指向**（弧度）。
 *
 * 光束在目标方向两侧来回扫（`spread` 为最大偏角），相位每推进一轮扫一个来回。
 * 返回 `{ angle, offset }`：`offset` 是相对目标方向的偏差 —— 界面用它判断"是否锁定"。
 */
export function beamSweep(
  targetAngle: number,
  phase: number,
  spread = Math.PI / 5,
): { angle: number; offset: number } {
  // sin 让扫描是"来回"而不是"转圈"；相位经过 0.25/0.75 时正对目标 → 锁定
  const offset = Math.sin(phase * Math.PI * 2) * spread;
  return { angle: targetAngle + offset, offset };
}

/** 光束是否已对准目标（偏差小于容差即视为锁定） */
export function beamLocked(offset: number, tolerance = 0.06): boolean {
  return Math.abs(offset) <= tolerance;
}

/**
 * 电磁波的**波长**（屏幕像素）：频率越高，波越密。
 *
 * 取相对 2.4 GHz 的幂律缩放（`λ ∝ (2400/f)^0.9`）：2.4 GHz 约 40 px、
 * 5 GHz 约 20 px、6 GHz 约 17 px、NR 3.5 GHz 约 28 px。
 * 上下限是为了可读性：太长看不出"波"，太密糊成一条实线。
 * 用幂律而不是严格 1/f，是因为严格反比在 6 GHz/毫米波上会密到看不见。
 */
export function emWavelengthPx(frequencyMhz: number): number {
  const f = Number.isFinite(frequencyMhz) && frequencyMhz > 0 ? frequencyMhz : 2400;
  const wavelength = 40 * (2400 / f) ** 0.9;
  return Math.max(10, Math.min(56, wavelength));
}

/** 正弦波的采样点（沿 from→to，垂直方向做正弦摆动） */
export function emWavePoints(
  from: Point,
  to: Point,
  wavelengthPx: number,
  phase: number,
  amplitude = 6,
): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return [];
  const ux = dx / length;
  const uy = dy / length;
  // 法线方向：正弦沿它摆动
  const nx = -uy;
  const ny = ux;
  const waves = Math.max(1, length / Math.max(6, wavelengthPx));
  const steps = Math.max(24, Math.round(waves * 24));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const along = t * length;
    // 两端收窄（sin(πt) 包络），看起来像"从设备发出、进入设备"
    const envelope = Math.sin(Math.PI * t);
    const swing = Math.sin((along / wavelengthPx) * Math.PI * 2 - phase * Math.PI * 2) * amplitude * envelope;
    points.push({ x: from.x + ux * along + nx * swing, y: from.y + uy * along + ny * swing });
  }
  return points;
}

/**
 * 数据流光点的位置：一半向前、一半向后（"来回移动"）。
 *
 * 每个光点用 `t` 表示它在直线上的位置（0 = 提供方，1 = 对端），
 * `forward` 表示方向，`alpha` 在两端淡出。
 */
export function streamDots(
  phase: number,
  count = 4,
): { t: number; forward: boolean; alpha: number }[] {
  const dots: { t: number; forward: boolean; alpha: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const forward = i % 2 === 0;
    const base = (i / count) * 1;
    const t = ((forward ? phase : -phase) + base + 1) % 1;
    dots.push({ t, forward, alpha: Math.sin(Math.PI * t) * 0.95 });
  }
  return dots;
}

/** 连接线脉冲的位置与强度：一个亮的短段沿直线来回走 */
export function linePulse(phase: number): { at: number; alpha: number } {
  const t = ((phase * 2) % 1 + 1) % 1;
  // 一来一回：前半程正向、后半程反向
  const at = t < 0.5 ? t * 2 : (1 - t) * 2;
  return { at, alpha: 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, Math.max(0, at))) };
}

/** 六边形蜂窝单元的顶点（尖顶朝上，屏幕坐标） */
export function hexagonPoints(center: Point, radius: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
  return points;
}

/**
 * 六边形（尖顶朝上）的六个**相邻单元中心**。
 *
 * 取标准轴向布局的点顶六边形：横向间距 √3·R，斜向 (±√3R/2, ±1.5R)。
 * 有了邻居，"蜂窝网格"才像一张网，而不是一个孤零零的大多边形。
 */
export function hexNeighbours(center: Point, radius: number): Point[] {
  const dx = Math.sqrt(3) * radius;
  const dy = 1.5 * radius;
  return [
    { x: center.x + dx, y: center.y },
    { x: center.x + dx / 2, y: center.y - dy },
    { x: center.x - dx / 2, y: center.y - dy },
    { x: center.x - dx, y: center.y },
    { x: center.x - dx / 2, y: center.y + dy },
    { x: center.x + dx / 2, y: center.y + dy },
  ];
}

/**
 * 蜂窝网格里的终端位置：在"自己小区中心 → 邻居小区中心"之间来回移动，
 * 走到两端时切换基站（用返回值里的 `switching` 标记，绘制层据此闪一下）。
 */
export function cellMover(phase: number): { t: number; switching: boolean } {
  const t = ((phase * 2) % 1 + 1) % 1;
  const position = t < 0.5 ? t * 2 : (1 - t) * 2;
  return { t: position, switching: t < 0.04 || t > 0.96 };
}

/** 脉冲闪烁的强度：0（暗）–1（亮），有节奏地起落 */
export function pulseLevel(phase: number): number {
  return (Math.sin(phase * Math.PI * 2) + 1) / 2;
}

/* ────────────────────────────── 绘制 ────────────────────────────── */

function lineWidthFor(zoom: number, weight = 1): number {
  return Math.max(1.1, 2.1 * Math.sqrt(Math.max(0.05, zoom)) * weight);
}

/** 2. 信号涟漪：以设备为圆心的同心圆（只画到最远对端附近，避免铺满画布） */
function drawRipple(ctx: CanvasRenderingContext2D, group: ProviderGroup, phase: number): void {
  const reach = Math.max(40, ...group.peers.map((peer) => peer.distancePx));
  ctx.save();
  ctx.strokeStyle = group.tint;
  ctx.lineWidth = lineWidthFor(1, 0.9);
  for (const ring of rippleRings(reach * 1.05, phase)) {
    if (ring.alpha <= 0.02) continue;
    ctx.globalAlpha = ring.alpha;
    ctx.beginPath();
    ctx.arc(group.center.x, group.center.y, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** 3. 波束扫描：扇形光束来回扫，对准对端时收窄并闪一下"锁定" */
function drawBeams(ctx: CanvasRenderingContext2D, group: ProviderGroup, phase: number): void {
  const reach = Math.max(60, ...group.peers.map((peer) => peer.distancePx));
  for (const peer of group.peers) {
    const target = Math.atan2(peer.center.y - group.center.y, peer.center.x - group.center.x);
    const { angle, offset } = beamSweep(target, phase);
    const locked = beamLocked(offset);
    const half = locked ? Math.PI / 40 : Math.PI / 16;

    ctx.save();
    ctx.translate(group.center.x, group.center.y);
    ctx.rotate(angle);
    const gradient = ctx.createLinearGradient(0, 0, reach, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0.05)');
    gradient.addColorStop(1, group.tint);
    ctx.globalAlpha = locked ? 0.42 : 0.2;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, reach, -half, half);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = locked ? 0.95 : 0.5;
    ctx.strokeStyle = group.tint;
    ctx.lineWidth = lineWidthFor(1, locked ? 1.2 : 0.8);
    ctx.stroke();
    ctx.restore();

    // 锁定提示：对端上方一个准星
    if (locked) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = group.tint;
      ctx.lineWidth = 1.2;
      const r = 12;
      ctx.beginPath();
      ctx.moveTo(peer.center.x - r, peer.center.y);
      ctx.lineTo(peer.center.x - r * 0.4, peer.center.y);
      ctx.moveTo(peer.center.x + r * 0.4, peer.center.y);
      ctx.lineTo(peer.center.x + r, peer.center.y);
      ctx.moveTo(peer.center.x, peer.center.y - r);
      ctx.lineTo(peer.center.x, peer.center.y - r * 0.4);
      ctx.moveTo(peer.center.x, peer.center.y + r * 0.4);
      ctx.lineTo(peer.center.x, peer.center.y + r);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** 4. 数据流光点：一半向前、一半向后，两端淡出 */
function drawStream(ctx: CanvasRenderingContext2D, group: ProviderGroup, phase: number): void {
  ctx.save();
  ctx.fillStyle = group.tint;
  ctx.shadowColor = group.tint;
  ctx.shadowBlur = 6;
  for (const peer of group.peers) {
    for (const dot of streamDots(phase)) {
      if (dot.alpha <= 0.03) continue;
      const x = group.center.x + (peer.center.x - group.center.x) * dot.t;
      const y = group.center.y + (peer.center.y - group.center.y) * dot.t;
      ctx.globalAlpha = dot.alpha;
      ctx.beginPath();
      ctx.arc(x, y, dot.forward ? 2.6 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 5. 连接线：一条动态连线 + 沿线来回的亮脉冲 */
function drawConnectionLine(ctx: CanvasRenderingContext2D, group: ProviderGroup, phase: number): void {
  const pulse = linePulse(phase);
  ctx.save();
  ctx.strokeStyle = group.tint;
  ctx.lineCap = 'round';
  for (const peer of group.peers) {
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = lineWidthFor(1, 0.7);
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(group.center.x, group.center.y);
    ctx.lineTo(peer.center.x, peer.center.y);
    ctx.stroke();

    // 脉冲段：以 pulse.at 为中心的一小段实线
    ctx.setLineDash([]);
    ctx.globalAlpha = pulse.alpha;
    ctx.lineWidth = lineWidthFor(1, 1.4);
    const half = 0.12;
    const from = Math.max(0, pulse.at - half);
    const to = Math.min(1, pulse.at + half);
    ctx.beginPath();
    ctx.moveTo(
      group.center.x + (peer.center.x - group.center.x) * from,
      group.center.y + (peer.center.y - group.center.y) * from,
    );
    ctx.lineTo(
      group.center.x + (peer.center.x - group.center.x) * to,
      group.center.y + (peer.center.y - group.center.y) * to,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** 6. 蜂窝网格：一族六边形小区 + 在小区之间移动（并切换基站）的终端 */
function drawCellGrid(ctx: CanvasRenderingContext2D, group: ProviderGroup, phase: number): void {
  /*
   * 小区半径要**夹取**：真实覆盖半径换算成屏幕后可能上千像素（30 m × 20 × 缩放），
   * 直接拿来画会得到一个铺满画布的大多边形（实测 80 万像素、完全看不出"蜂窝"）。
   * 夹到 90–180 px：既有"一个小区"的体量，又能看见邻居、看得出网格。
   */
  const radius = Math.max(90, Math.min(180, group.coverageRadiusPx > 0 ? group.coverageRadiusPx : 120));
  const neighbours = hexNeighbours(group.center, radius);
  const mover = cellMover(phase);

  const drawHex = (center: Point, fill: number, stroke: number) => {
    const hex = hexagonPoints(center, radius);
    ctx.beginPath();
    hex.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    ctx.closePath();
    if (fill > 0) {
      ctx.globalAlpha = fill;
      ctx.fillStyle = group.tint;
      ctx.fill();
    }
    ctx.globalAlpha = stroke;
    ctx.strokeStyle = group.tint;
    ctx.lineWidth = lineWidthFor(1, 0.8);
    ctx.stroke();
  };

  ctx.save();
  // 邻居小区：只描边（画出一张网），中心小区：淡填充（"这是本站的小区"）
  for (const neighbour of neighbours) drawHex(neighbour, 0, 0.26);
  drawHex(group.center, 0.07, 0.62);

  ctx.restore();

  // 终端：从本站小区走向对端方向的邻居小区，走到两端即"切换基站"
  for (const peer of group.peers) {
    const direction = Math.atan2(peer.center.y - group.center.y, peer.center.x - group.center.x);
    // 取方向上最接近的邻居小区中心
    const target = neighbours.reduce((best, candidate) => {
      const angle = Math.atan2(candidate.y - group.center.y, candidate.x - group.center.x);
      const delta = Math.abs(Math.atan2(Math.sin(angle - direction), Math.cos(angle - direction)));
      const bestAngle = Math.atan2(best.y - group.center.y, best.x - group.center.x);
      const bestDelta = Math.abs(Math.atan2(Math.sin(bestAngle - direction), Math.cos(bestAngle - direction)));
      return delta < bestDelta ? candidate : best;
    }, neighbours[0] as Point);

    const x = group.center.x + (target.x - group.center.x) * mover.t;
    const y = group.center.y + (target.y - group.center.y) * mover.t;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = mover.switching ? '#fbbf24' : group.tint;
    ctx.beginPath();
    ctx.arc(x, y, mover.switching ? 5 : 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** 7. 电磁波：正弦波沿路径传播（频率越高越密） */
function drawEmWave(
  ctx: CanvasRenderingContext2D,
  group: ProviderGroup,
  phase: number,
  wavelengthPx: number,
): void {
  ctx.save();
  ctx.strokeStyle = group.tint;
  ctx.lineWidth = lineWidthFor(1, 1.1);
  ctx.lineJoin = 'round';
  for (const peer of group.peers) {
    const points = emWavePoints(group.center, peer.center, wavelengthPx, phase);
    if (points.length < 2) continue;
    ctx.beginPath();
    points.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    ctx.globalAlpha = 0.9;
    ctx.stroke();
  }
  ctx.restore();
}

/** 8. Massive MIMO：从同一天线阵列同时指向**每一台**对端的窄波束 */
function drawMimo(ctx: CanvasRenderingContext2D, group: ProviderGroup, phase: number): void {
  const reach = Math.max(60, ...group.peers.map((peer) => peer.distancePx));
  group.peers.forEach((peer, index) => {
    const target = Math.atan2(peer.center.y - group.center.y, peer.center.x - group.center.x);
    const intensity = 0.45 + 0.45 * Math.sin((phase * 2 + index / group.peers.length) * Math.PI * 2) ** 2;
    ctx.save();
    ctx.translate(group.center.x, group.center.y);
    ctx.rotate(target);
    ctx.globalAlpha = intensity;
    const gradient = ctx.createLinearGradient(0, 0, reach, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0.08)');
    gradient.addColorStop(1, group.tint);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, reach, -Math.PI / 60, Math.PI / 60);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
}

/** 9. 脉冲闪烁：两端图标外圈有节奏地亮起 */
function drawPulse(ctx: CanvasRenderingContext2D, group: ProviderGroup, phase: number): void {
  const level = pulseLevel(phase);
  const centers = [group.center, ...group.peers.map((peer) => peer.center)];
  ctx.save();
  ctx.strokeStyle = group.tint;
  ctx.fillStyle = group.tint;
  for (const center of centers) {
    // 两圈错相位的环：一圈扩散、一圈刚起，闪烁才有"心跳"的节奏
    const radius = 18 + level * 16;
    ctx.globalAlpha = (1 - level) * 0.8;
    ctx.lineWidth = lineWidthFor(1, 1.6);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = level * 0.55;
    ctx.lineWidth = lineWidthFor(1, 1.1);
    ctx.beginPath();
    ctx.arc(center.x, center.y, 10 + level * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowColor = group.tint;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = 0.35 + level * 0.65;
    ctx.beginPath();
    ctx.arc(center.x, center.y, 4 + level * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

/** 信号波（默认）：三条一组弧线沿直线推进 —— 实现见 `signals.ts`（那里有完整单测） */
export interface WaveFront {
  cx: number;
  cy: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  group: number;
  layer: number;
}

export const ARC_SPREAD = Math.PI / 5;
export const ARCS_PER_GROUP = 3;
const GROUP_SPACING_PX = 150;
const MAX_GROUPS = 5;
const MIN_GROUPS = 2;
const ARC_GAP_RATIO = 0.3;

/** 弧线半径（屏幕像素）：按 √zoom 收缩，有上下限（缩到 13% 也看得见） */
export function waveFrontRadius(zoom: number): number {
  return Math.max(9, Math.min(26, 26 * Math.sqrt(Math.max(0, zoom))));
}

export function waveFrontRatios(length: number, phase: number): number[] {
  const count = Math.max(MIN_GROUPS, Math.min(MAX_GROUPS, Math.round(length / GROUP_SPACING_PX)));
  return Array.from({ length: count }, (_, i) => (((phase + i / count) % 1) + 1) % 1);
}

export function waveFronts(from: Point, to: Point, phase: number, radius: number): WaveFront[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return [];
  const direction = Math.atan2(dy, dx);
  const gap = Math.max(3, radius * ARC_GAP_RATIO);
  const fronts: WaveFront[] = [];
  waveFrontRatios(length, phase).forEach((t, group) => {
    const px = from.x + dx * t;
    const py = from.y + dy * t;
    const cx = px - Math.cos(direction) * radius;
    const cy = py - Math.sin(direction) * radius;
    for (let k = 0; k < ARCS_PER_GROUP; k += 1) {
      fronts.push({
        cx,
        cy,
        radius: Math.max(1, radius - k * gap),
        startAngle: direction - ARC_SPREAD,
        endAngle: direction + ARC_SPREAD,
        group,
        layer: k,
      });
    }
  });
  return fronts;
}

function drawWaves(
  ctx: CanvasRenderingContext2D,
  group: ProviderGroup,
  phase: number,
  zoom: number,
): void {
  const radius = waveFrontRadius(zoom);
  const LAYER_ALPHA = [1, 0.72, 0.46];
  ctx.save();
  ctx.strokeStyle = group.tint;
  ctx.lineCap = 'round';
  for (const peer of group.peers) {
    const length = peer.distancePx;
    const ratios = waveFrontRatios(length, phase);
    for (const front of waveFronts(group.center, peer.center, phase, radius)) {
      const t = ratios[front.group] ?? 0;
      const layer = LAYER_ALPHA[front.layer] ?? 1;
      const alpha = Math.sin(Math.PI * t) * 0.9 * layer;
      if (alpha <= 0.02 || front.radius <= 1) continue;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(1.2, (radius / 12) * (0.7 + 0.3 * layer));
      ctx.beginPath();
      ctx.arc(front.cx, front.cy, front.radius, front.startAngle, front.endAngle);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* ────────────────────────────── 调度 ────────────────────────────── */

export interface DrawStyleParams {
  ctx: CanvasRenderingContext2D;
  group: ProviderGroup;
  phase: number;
  zoom: number;
  /** 该组信号的**代表频点**（MHz）：电磁波的波长按它算 */
  frequencyMhz: number;
}

/** 画一组（一台提供方 + 它的全部对端）。九种形态在这里分发。 */
export function drawProviderGroup({ ctx, group, phase, zoom, frequencyMhz }: DrawStyleParams): void {
  switch (group.style) {
    case 'ripple':
      drawRipple(ctx, group, phase);
      break;
    case 'beam':
      drawBeams(ctx, group, phase);
      break;
    case 'stream':
      drawStream(ctx, group, phase);
      break;
    case 'line':
      drawConnectionLine(ctx, group, phase);
      break;
    case 'cell':
      drawCellGrid(ctx, group, phase);
      break;
    case 'em':
      drawEmWave(ctx, group, phase, emWavelengthPx(frequencyMhz));
      break;
    case 'mimo':
      drawMimo(ctx, group, phase);
      break;
    case 'pulse':
      drawPulse(ctx, group, phase);
      break;
    case 'waves':
    default:
      drawWaves(ctx, group, phase, zoom);
      break;
  }
}

/* ────────────────────────────── 分组 ────────────────────────────── */

/** 由设备（提供方）与其对端构成的屏幕几何 */
export function providerGeometry(
  device: Device,
  camera: Viewport,
  peerDevices: Device[],
): Omit<ProviderGroup, 'style' | 'tint'> {
  const centerWorld = deviceCenter(device);
  const center = worldToScreen(camera, centerWorld.x, centerWorld.y);
  const coverage = device.wireless?.coverage;
  const coverageRadiusPx = coverage
    ? coverageGeometry(coverage).radiusWorld * camera.k
    : 0;
  return {
    deviceId: device.id,
    device,
    center,
    coverageRadiusPx,
    peers: peerDevices.map((peer, index) => {
      const peerWorld = deviceCenter(peer);
      const point = worldToScreen(camera, peerWorld.x, peerWorld.y);
      return {
        linkId: `peer-${index}`,
        peerDeviceId: peer.id,
        device: peer,
        center: point,
        distancePx: Math.hypot(point.x - center.x, point.y - center.y),
      };
    }),
  };
}

/** 设备在画布上的颜色（与卡片一致） */
export function tintOfDevice(device: Device): string {
  return KIND_COLOR[device.kind] ?? '#38bdf8';
}
