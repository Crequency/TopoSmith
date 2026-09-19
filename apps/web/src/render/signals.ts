/**
 * 无线信号波动画（独立覆盖层）
 *
 * 无线关联不再画线，取而代之的是两件事：
 *   · **覆盖圈**说明"能服务到哪"（`draw.ts` 的 drawCoverages）；
 *   · **信号波**说明"这条关联此刻是通的"（本文件）。
 *
 * 信号波的形态（用户给定）：以**无线设备卡片中心为原点**，沿**直线**射向接收设备，
 * 表现为**若干条平行的弧线**依次推进 —— 像水波一样一道道刷过去，到达接收端后淡出。
 * 之所以用弧线而不是圆点：弧线有"波前"的指向性，一眼能看出"从谁发向谁"；
 * 平行（同一曲率半径）则让"这是一串波"而不是"一堆散乱的弧"。
 *
 * 为什么单独一层画布：信号波是**常驻动画**。若把它画进主场景，每一帧都要重画
 * 800 条连线与 700 多张卡片（实测主场景一帧十几毫秒），为了几条弧线而让常驻 rAF
 * 烧掉半个核，与"静止时不烧 CPU"的既有约定（FR-50）直接冲突。
 * 覆盖层只有几条弧线，一帧不到 0.1 ms，且清空它不需要碰主场景。
 *
 * 这一层是**纯绘制**：相位由调用方推进（`SignalParams.phase`），
 * 因此"降低动效"只要不推进相位即可得到一张静态图 —— 不需要在这里分支。
 */

import { KIND_COLOR, worldToScreen } from './draw';
import { coverageView } from '../lib/coverage';
import { deviceCenter, type Point } from '@toposmith/schema';
import type { DerivedLink, World } from '@toposmith/anvil';
import type { Viewport } from '../state/store';

export interface SignalParams {
  world: World;
  camera: Viewport;
  width: number;
  height: number;
  /** 动画相位（0–1）。调用方按时间推进；不推进就是静态图 */
  phase: number;
}

/** 弧线的角张开的一半（弧度）：约 ±36°，看起来像一段"波前"而不是半圆 */
const ARC_SPREAD = Math.PI / 5;
/**
 * 每组弧线的条数：**3 条**，像 WiFi 图标那样由内向外排开（用户给定的形态）。
 * 一条弧看不出"这是一组波"，三条才有图标一样的辨识度。
 */
export const ARCS_PER_GROUP = 3;
/**
 * 每组之间的目标间距（屏幕像素）：密度不随链路长度变化。
 * 3 条弧一组比单条弧"占地方"，因此间距比单弧方案（70 px）大一倍多，
 * 否则相邻两组会互相插进去、糊成一团。
 */
const GROUP_SPACING_PX = 150;
/** 一条关联上同时可见的**组**数上限（太密会糊成一片） */
const MAX_GROUPS = 5;
const MIN_GROUPS = 2;
/**
 * 组内相邻弧线的间距 = 基准半径 × 这个系数。
 *
 * 上限是 1/2：三条弧的半径分别 R、R−gap、R−2gap，取 0.52 时最内那条会变成**负数** ——
 * `ctx.arc` 遇到负半径直接抛 IndexSizeError，而动效是在渲染 effect 里跑的，
 * 一抛就把整棵组件树卸掉（现象是"画布整个消失"）。0.3 既保证最内弧仍有 0.4R，
 * 三条弧的层次也够清楚。
 */
const ARC_GAP_RATIO = 0.3;

/** 波形弧线（屏幕坐标）：弧心 + 半径 + 起止角 */
export interface WaveFront {
  /** 弧心：在波前位置的后方一个半径处，于是弧线朝接收端鼓起 */
  cx: number;
  cy: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  /** 属于第几组（同组的三条弧共用一个弧心，像 WiFi 图标那样由内向外排开） */
  group: number;
  /** 组内第几条：0 = 前导弧（最靠近接收端、最实），1/2 依次后退、渐淡 */
  layer: number;
}

/**
 * 弧线半径（屏幕像素）。
 *
 * 缩放越小卡片越小，弧线也该跟着收 —— 但**不能线性跟着缩**：
 * 缩到 13%（IDC 场景）时线性会让弧线细到看不见。取 √zoom 折中：
 * 100% → 26 px，25% → 13 px，10% → 9 px（下限）。
 */
export function waveFrontRadius(zoom: number): number {
  return Math.max(9, Math.min(26, 26 * Math.sqrt(Math.max(0, zoom))));
}

/**
 * 一条关联上此刻的波前（纯函数，便于单测与端到端断言"真的是平行弧线"）。
 *
 * 波前位置 `t = (phase + i / count) mod 1`，沿 from→to 的**直线**均匀推进；
 * 所有弧线共用同一个半径，因此彼此**平行**；弧心退回一个半径，
 * 于是弧顶正好落在直线上、朝接收端鼓。
 */
export function waveFronts(from: Point, to: Point, phase: number, radius: number): WaveFront[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return [];
  const direction = Math.atan2(dy, dx);
  const gap = Math.max(3, radius * ARC_GAP_RATIO);
  const fronts: WaveFront[] = [];
  const ratios = waveFrontRatios(length, phase);

  ratios.forEach((t, group) => {
    // 该组的**前导弧**顶点正好落在 t 处，整组共用一个弧心 → 与前导弧同心、半径递减
    const px = from.x + dx * t;
    const py = from.y + dy * t;
    const cx = px - Math.cos(direction) * radius;
    const cy = py - Math.sin(direction) * radius;
    for (let k = 0; k < ARCS_PER_GROUP; k += 1) {
      fronts.push({
        cx,
        cy,
        // 从外到内：前导弧最大（顶点在 t 处），后面的逐条后退一个间距
        // （下限 1 px：半径必须为正，否则 ctx.arc 会抛错把组件树带崩）
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

/** 每一**组**波前在直线上的归一化位置（0 = 发射端，1 = 接收端） */
export function waveFrontRatios(length: number, phase: number): number[] {
  const count = Math.max(MIN_GROUPS, Math.min(MAX_GROUPS, Math.round(length / GROUP_SPACING_PX)));
  return Array.from({ length: count }, (_, i) => (((phase + i / count) % 1) + 1) % 1);
}

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

/** 提供覆盖的那一端（信号从它发出）；两端都提供时取 a 端 */
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

/** 一条关联的几何：发射端 = 提供方的卡片中心，接收端 = 对端卡片中心（屏幕坐标） */
export interface SignalGeometry {
  linkId: string;
  providerDeviceId: string;
  peerDeviceId: string;
  from: Point;
  to: Point;
  radius: number;
  fronts: WaveFront[];
}

/** 算出某条关联此刻的信号波几何（端到端脚本按它断言，绘制也用它） */
export function signalGeometry(
  world: World,
  camera: Viewport,
  link: DerivedLink,
  phase: number,
): SignalGeometry | null {
  const provider = providerEnd(world, link) === 'a' ? link.a : link.b;
  const peer = provider === link.a ? link.b : link.a;
  const fromDevice = world.devices.get(provider.deviceId);
  const toDevice = world.devices.get(peer.deviceId);
  if (!fromDevice || !toDevice) return null;

  // 以**卡片中心**为原点（不是端口位置）：用户要的是"设备之间在传波"
  const fromWorld = deviceCenter(fromDevice);
  const toWorld = deviceCenter(toDevice);
  const from = worldToScreen(camera, fromWorld.x, fromWorld.y);
  const to = worldToScreen(camera, toWorld.x, toWorld.y);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 24) return null; // 两张卡片几乎重叠：没有"传递"可言，画了只是一团糊

  const radius = waveFrontRadius(camera.k);
  return {
    linkId: link.id,
    providerDeviceId: provider.deviceId,
    peerDeviceId: peer.deviceId,
    from,
    to,
    radius,
    fronts: waveFronts(from, to, phase, radius),
  };
}

/**
 * 画一帧信号波。返回屏幕上真正画出来的关联条数。
 *
 * 调用方负责先 `clearRect`：这一层是完全透明的覆盖层，只画信号本身。
 */
export function drawSignals(ctx: CanvasRenderingContext2D, params: SignalParams): number {
  const { world, camera, phase } = params;
  const links = signalLinks(world);
  if (links.length === 0) return 0;

  const margin = 120;
  let drawn = 0;

  for (const link of links) {
    const geometry = signalGeometry(world, camera, link, phase);
    if (!geometry) continue;

    // 整条连线（含弧线半径）都在视口外就跳过 —— 覆盖层也要省着画
    const minX = Math.min(geometry.from.x, geometry.to.x) - geometry.radius - margin;
    const maxX = Math.max(geometry.from.x, geometry.to.x) + geometry.radius + margin;
    const minY = Math.min(geometry.from.y, geometry.to.y) - geometry.radius - margin;
    const maxY = Math.max(geometry.from.y, geometry.to.y) + geometry.radius + margin;
    if (maxX < 0 || minX > params.width || maxY < 0 || minY > params.height) continue;

    drawWaveFrontStack(ctx, geometry, tintOf(world, link), phase);
    drawn += 1;
  }
  return drawn;
}

/**
 * 画一串平行弧线。
 *
 * 透明度按波前在直线上的位置做正弦包络：发射端与接收端都淡（像是"发出"与"收到"），
 * 中段最实。相位回绕时整串波无缝衔接，不会出现"跳一下"。
 */
function drawWaveFrontStack(
  ctx: CanvasRenderingContext2D,
  geometry: SignalGeometry,
  color: string,
  phase: number,
): void {
  const length = Math.hypot(geometry.to.x - geometry.from.x, geometry.to.y - geometry.from.y);
  const ratios = waveFrontRatios(length, phase);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';

  // 组内三条弧的透明度：前导弧最实、越往后越淡（WiFi 图标的层次感）
  const LAYER_ALPHA = [1, 0.72, 0.46];

  geometry.fronts.forEach((front) => {
    const t = ratios[front.group] ?? 0;
    // sin 包络：发射端与接收端透明，中段最亮
    const layer = LAYER_ALPHA[front.layer] ?? 1;
    const alpha = Math.sin(Math.PI * t) * 0.9 * layer;
    if (alpha <= 0.02 || front.radius <= 1) return;
    ctx.globalAlpha = alpha;
    // 后面的弧线略细一点，层次更清楚
    ctx.lineWidth = Math.max(1.2, (geometry.radius / 12) * (0.7 + 0.3 * layer));
    ctx.beginPath();
    ctx.arc(front.cx, front.cy, front.radius, front.startAngle, front.endAngle);
    ctx.stroke();
  });

  ctx.restore();
}
