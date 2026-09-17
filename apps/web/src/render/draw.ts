/**
 * 画布绘制（纯函数层）
 *
 * 与交互、状态完全解耦：所有函数都是「世界坐标 → 屏幕坐标」的确定映射。
 * 换渲染后端（M2 切 WebGL）时只需重写本文件，交互与状态层不动
 * （docs/04-architecture.md §3）。
 *
 * 本轮的三个结构性变化：
 *  1. **端口常驻**：设备卡片底部是端口条带，每个端口按介质画成对应形状（FR-32）；
 *  2. **端口到端口连线**：连线从端口图元出发、以电缆状曲线接到对端端口（FR-33）；
 *  3. **速率配色**：连线本体与标签的颜色都编码链路速率，越高越绿（FR-34）。
 */

import type { Device, DeviceKind, Port, PortMedium } from '@toposmith/schema';
import { DEVICE_KIND_LABEL, DEVICE_SUBTYPE_LABEL } from '@toposmith/schema';
import { cableLabel, cableSpec, formatSpeed } from '@toposmith/catalog';
import type { DerivedLink, World } from '@toposmith/engine';
import { deviceIcon, strokeIcon, uiIcon } from '../lib/icons';
import {
  DEFAULT_RACK_UNITS,
  NODE_H,
  NODE_W,
  RACK_HEADER_H,
  boxContainsPoint,
  cardHeightOf,
  cardWidthOf,
  deviceFlipButtonRect,
  cardResizeEdge,
  deviceRect,
  hitRect,
  rackRect,
  rackUnitsOf,
  RACK_PAD_X,
  RACK_RAIL_W,
  RACK_UNIT_H,
  RACK_W,
  rackFlipButtonRect,
  rackHeight,
  rackHeightU,
  type Box,
  type Point,
  type SnapGuides,
} from '../lib/geometry';
import {
  PANEL_HEADER_H,
  deviceSide,
  hasRearPorts,
  panelBand,
  portLayout,
  portSide,
  visiblePortGlyphs,
  type PortGlyph,
} from '../lib/ports';
import { speedColor, speedColorAlpha } from '../lib/speed-color';
import { pointAt, type FlowPath } from '../lib/flow';
import type { LinkDraft, Selection, Viewport } from '../state/store';

export { NODE_H, NODE_W };
// 卡片矩形的实现已归位到 lib/geometry（纯几何，store 也要用）；这里继续对外导出，
// 免得所有绘制调用方都要多 import 一个模块。
export { deviceRect, hitRect };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const KIND_COLOR: Record<DeviceKind, string> = {
  ont: '#0284c7',
  router: '#16a34a',
  switch: '#9333ea',
  computer: '#d97706',
  mobile: '#e11d48',
  embedded: '#0d9488',
  ap: '#4f46e5',
  olt: '#0891b2',
  cloud: '#475569',
  rack: '#334155',
};

/**
 * 画布文字字体族：与 index.css 的 --font-sans 保持一致，
 * 显式点名中文字体，避免在缺字体的环境里把中文画成方框。
 */
export const UI_FONT =
  "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC', ui-sans-serif, system-ui, sans-serif";

const MONO_FONT = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

/**
 * 细节分级（LOD，FR-56）。
 *
 * 中型 IDC 场景有 800+ 设备、800+ 连线：如果每一帧都把端口图元、端口名、
 * 速率标签、机柜 42 个 U 位格画一遍，一帧要 100 ms 左右（实测），拖动直接掉到 10 FPS。
 * 而在缩放到 13% 的时候，这些东西本来就只有 1 px 宽、根本看不清 —— 画了是纯浪费。
 *
 * 于是按缩放分三档：
 *   · k < LOD_STRUCTURE：只画结构（卡片/机柜外框 + 连线），不画端口、不画标签
 *   · k < LOD_DETAIL：加画端口图元、机柜 U 位格、设备名，但仍不画端口名与速率标签
 *   · 其他：全细节（默认观感不变）
 */
const LOD_STRUCTURE = 0.18;
const LOD_DETAIL = 0.45;
/** 连线速率标签的最小缩放（低于它就只剩重叠的文字噪声） */
const LOD_CABLE_LABEL = 0.4;

/** 世界矩形是否与视口相交（带 margin 世界单位）；用于跳过画不到的图元 */
function boxInView(box: Rect, params: DrawParams, margin = 24): boolean {
  const { camera, width, height } = params;
  const left = (0 - camera.x) / camera.k - margin;
  const top = (0 - camera.y) / camera.k - margin;
  const right = (width - camera.x) / camera.k + margin;
  const bottom = (height - camera.y) / camera.k + margin;
  return box.x <= right && box.x + box.w >= left && box.y <= bottom && box.y + box.h >= top;
}

/**
 * 悬浮时的"透视"透明度：机柜与**有背板端口的设备**共用同一个值。
 *
 * 取 0.42 是刻意的折中：还能看出这是哪台设备（轮廓、色条、端口位置都还在），
 * 但已经能看清压在他下面的东西（另一面的端口图元、电缆、标签）。
 */
const HOVER_FADE = 0.42;

/**
 * 观察面的颜色（FR-52）：正面 = 亮青，背面 = 琥珀。
 * 这两个值原本是画在卡片上的"正面/背面"文字的填充色，现在改用于翻转按钮的边框与图标。
 */
export const SIDE_COLOR_FRONT = '#7dd3fc';
export const SIDE_COLOR_REAR = '#fbbf24';

/**
 * 翻转按钮的悬浮提示文案（FR-52）。
 *
 * 卡片上不再常驻"正面/背面"文字，所以"现在看的是哪一面"必须在这里说清楚 ——
 * 提示既报**当前面**（用户最想知道的），也报**点一下会怎样**（可预期）。
 * 抽成纯函数是为了能直接断言措辞，而不必靠像素去猜。
 */
export function flipTooltipText(flipped: boolean): string {
  return flipped ? '当前：背面 · 点击看正面' : '当前：正面 · 点击看背面';
}

export function worldToScreen(cam: Viewport, x: number, y: number): Point {
  return { x: x * cam.k + cam.x, y: y * cam.k + cam.y };
}

export function screenToWorld(cam: Viewport, x: number, y: number): Point {
  return { x: (x - cam.x) / cam.k, y: (y - cam.y) / cam.k };
}

/**
 * 指针下的设备。
 *
 * **非机柜设备优先**：机柜是容器，它的矩形把柜内设备整个罩住，
 * 若只按"后画的先命中"（`ordered` 是 id 字典序，与 z 序无关）遍历，
 * 那么"能不能选中柜内设备 / 悬浮时淡出的是谁"就取决于设备 id 的字典序 ——
 * 一个随 id 变化的行为不是行为，是巧合。所以先找最具体的设备，都没中才落到机柜上。
 */
export function hitDevice(world: World, wx: number, wy: number): Device | undefined {
  let rack: Device | undefined;
  for (let i = world.ordered.length - 1; i >= 0; i -= 1) {
    const device = world.ordered[i] as Device;
    const rect = hitRect(device);
    if (wx < rect.x || wx > rect.x + rect.w || wy < rect.y || wy > rect.y + rect.h) continue;
    if (device.kind === 'rack') {
      rack ??= device;
      continue;
    }
    return device;
  }
  return rack;
}

/* ────────────────────────────── 电缆路径 ────────────────────────────── */

// 路由与摆动偏移的实现都在 lib/link-path.ts（纯几何，store 也要用）。
// 这里继续对外导出，绘制层与端到端脚本按老路径 import 即可。
import { cableDropFor, linkPath, type CablePath, type CableSwayOffset } from '../lib/link-path';

export { cableDropFor, linkPath, type CablePath, type CableSwayOffset };

/* ────────────────────────────── 连线标签 ────────────────────────────── */

/**
 * 标签文字。速率是链路协商的结果，`不可用`表示链路起不来（标签转红）。
 */
function labelText(link: DerivedLink): string {
  if (!link.up) return '不可用';
  return link.family === 'wireless'
    ? `WiFi ${formatSpeed(link.speedMbps)}`
    : formatSpeed(link.speedMbps);
}

const LABEL_FONT_SIZE = 11;
const LABEL_FONT = `600 ${LABEL_FONT_SIZE}px ${UI_FONT}`;
const LABEL_PAD_X = 7;
const LABEL_HEIGHT = 18;
/**
 * 连线标签此刻**是否看得见**（LOD）。
 *
 * 绘制与命中测试必须用同一个判据：缩到 13% 时标签已经不画了，
 * 但它的命中矩形是按屏幕尺寸换算成世界坐标的（44 px ÷ 0.13 ≈ 340 世界单位），
 * 于是"看不见的标签"会盖住一大片卡片，点设备变成拖标签 ——
 * 实测这一处让 800 台设备的拖动从 1 ms/帧变成 100 ms/帧（走的是 patchCable 的完整重建）。
 */
export function cableLabelVisible(
  linkId: string,
  camera: Viewport,
  emphasized: readonly string[] = [],
): boolean {
  return camera.k >= LOD_CABLE_LABEL || emphasized.includes(linkId);
}

/** 命中判定的额外宽容（屏幕像素）—— 标签很小，不容宽一点很难点中 */
const LABEL_HIT_PAD = 4;
/** 命中框的宽度下限（屏幕像素）：短文案（"1 Gbps"）也给一个够点的宽度 */
const LABEL_MIN_HIT_W = 44;

/**
 * 标签在**屏幕空间**是固定尺寸（不随缩放变大变小），所以尺寸只能在绘制时量。
 *
 * 用一个离屏 2D 上下文量文字宽度，而不是"缓存上一帧画出来的矩形"：
 * 后者在缩放与首帧会出现一拍延迟，命中框与看到的标签对不上。
 */
let measureCtx: CanvasRenderingContext2D | null = null;
let measureFailed = false;

function labelScreenSize(text: string): { w: number; h: number } {
  if (!measureCtx && !measureFailed && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d');
    measureFailed = measureCtx === null;
  }
  if (measureCtx) {
    measureCtx.font = LABEL_FONT;
    return { w: measureCtx.measureText(text).width + LABEL_PAD_X * 2, h: LABEL_HEIGHT };
  }
  // 无 DOM 环境（单测）：按等宽估算，只影响命中框的宽窄，不影响位置
  return { w: text.length * LABEL_FONT_SIZE * 0.62 + LABEL_PAD_X * 2, h: LABEL_HEIGHT };
}

/**
 * 标签的命中矩形（**世界坐标**）。
 *
 * 标签是固定屏幕尺寸的图元，因此世界尺寸要除以缩放系数 `camera.k` ——
 * 这样"放大了更好点"这件事对用户是自然的，而不需要另加容差规则。
 */
export function cableLabelRect(
  world: World,
  link: DerivedLink,
  camera: Viewport,
  sway?: CableSwayOffset,
): Rect | null {
  const path = linkPath(world, link, sway);
  if (!path) return null;
  const size = labelScreenSize(labelText(link));
  const k = camera.k === 0 ? 1 : camera.k;
  const w = (Math.max(size.w, LABEL_MIN_HIT_W) + LABEL_HIT_PAD * 2) / k;
  const h = (size.h + LABEL_HIT_PAD * 2) / k;
  return {
    x: path.labelPoint.x - w / 2,
    y: path.labelPoint.y - h / 2,
    w,
    h,
  };
}

/**
 * 命中哪一个连线标签。
 *
 * 倒序遍历：标签与线体一样是"后画的在上层"，同一处叠了两个标签时应该命中
 * 用户看见的那一个（最后画的那个）。
 */
export function hitCableLabel(
  world: World,
  camera: Viewport,
  wx: number,
  wy: number,
  cableSway?: Map<string, CableSwayOffset>,
  emphasized: readonly string[] = [],
): DerivedLink | undefined {
  const point = { x: wx, y: wy };
  for (let i = world.links.length - 1; i >= 0; i -= 1) {
    const link = world.links[i] as DerivedLink;
    // 看不见的标签不该被点到（绘制与命中同一条判据）
    if (!cableLabelVisible(link.id, camera, emphasized)) continue;
    const rect = cableLabelRect(world, link, camera, cableSway?.get(link.id));
    if (rect && boxContainsPoint(rect, point)) return link;
  }
  return undefined;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function hitCable(
  world: World,
  wx: number,
  wy: number,
  cableSway?: Map<string, CableSwayOffset>,
): DerivedLink | undefined {
  const point = { x: wx, y: wy };
  let best: { link: DerivedLink; distance: number } | undefined;
  for (const link of world.links) {
    const path = linkPath(world, link, cableSway?.get(link.id));
    if (!path) continue;
    let distance = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < path.points.length; i += 1) {
      distance = Math.min(
        distance,
        distanceToSegment(point, path.points[i] as Point, path.points[i + 1] as Point),
      );
    }
    if (distance <= 7 && (!best || distance < best.distance)) best = { link, distance };
  }
  return best?.link;
}

/** 线缆类型的中文摘要，供 UI 复用 */
export function cableSummary(link: DerivedLink): string {
  const spec = cableSpec(link.cable.type);
  if (spec.family === 'wireless') return '无线关联';
  return `${cableLabel(link.cable.type)} · ${link.cable.lengthM} m`;
}

/* ────────────────────────────── 绘制参数 ────────────────────────────── */

export interface FlowView {
  path: FlowPath;
  distances: number[];
  activeHop: number | null;
  stopped: boolean;
  pulse: number;
}

export interface DrawParams {
  world: World;
  camera: Viewport;
  width: number;
  height: number;
  selection: Selection;
  linkMode: boolean;
  linkDraft: LinkDraft | null;
  hoverPort: LinkDraft | null;
  /** 鼠标悬浮的机柜 id（悬浮时机柜半透明，便于看到另一面的端口） */
  hoverRackId: string | null;
  /**
   * 鼠标悬浮的**有背板端口的设备** id（悬浮时卡片半透明，露出另一面的端口图元）。
   * 与 `hoverRackId` 是同一套"透视"约定，只是作用对象从机柜变成设备本身（FR-48）。
   */
  hoverDeviceId: string | null;
  /** 悬浮或正在拖动的连线标签（画高亮环，提示"这个标签能拖"，FR-46） */
  activeLabelId: string | null;
  /**
   * 各条连线当前的**物理摆动偏移**（世界单位，FR-50）。
   * 由 Canvas 每帧推进弹簧模型后传进来；缺省表示没有摆动（静止帧）。
   */
  cableSway?: Map<string, CableSwayOffset>;
  /** 右边缘正在被悬浮/拖拽的可调宽设备：给它画一条拖拽把手（FR-49） */
  resizeHandleId?: string | null;
  /**
   * 本帧的连线路径缓存（FR-56）。
   *
   * 一条连线在一帧里要被问两次路径（线体趟 + 标签趟），800 条就是 1600 次
   * 三次贝塞尔采样；算一次存下来即可，且保证两趟画的是同一条曲线。
   */
  cablePaths?: Map<string, CablePath | null>;
  cursor: Point | null;
  marquee: Box | null;
  guides: SnapGuides;
  pathDeviceIds: string[];
  pathLinkIds: string[];
  pathStepByDevice: Map<string, number>;
  flow: FlowView | null;
}

export function drawScene(ctx: CanvasRenderingContext2D, params: DrawParams): void {
  const { world, camera, width, height } = params;

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, camera, width, height);

  // ── 链路（电缆曲线画在卡片下层；标签留到最后单独画，避免被卡片盖住）
  // 每帧只算一次路径，两趟绘制共用（800 条连线时这一项就是十几毫秒）
  const cablePaths = new Map<string, CablePath | null>();
  for (const link of world.links) {
    cablePaths.set(link.id, linkPath(world, link, params.cableSway?.get(link.id)));
  }
  const frameParams: DrawParams = { ...params, cablePaths };
  for (const link of world.links) drawCable(ctx, frameParams, link, 'stroke');

  // ── 吸附引导线
  if (params.guides.vertical.length > 0 || params.guides.horizontal.length > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (const worldX of params.guides.vertical) {
      const x = worldToScreen(camera, worldX, 0).x;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (const worldY of params.guides.horizontal) {
      const y = worldToScreen(camera, 0, worldY).y;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── 流向动画的"底层"（发光路径、箭头、粒子、阻断脉冲）在卡片之下
  if (params.flow) drawFlow(ctx, params, params.flow, 'under');

  // 机柜 U 位占用表：每帧只算一次（每个机柜各扫一遍所有设备是 O(柜×设备)）
  const occupancy = new Map<string, Map<number, number>>();
  for (const device of world.ordered) {
    if (!device.mount) continue;
    const slots = occupancy.get(device.mount.rackId) ?? new Map<number, number>();
    slots.set(device.mount.startU, rackUnitsOf(device));
    occupancy.set(device.mount.rackId, slots);
  }

  // ── 机柜外壳（容器画在卡片下层，柜内设备才能"装在"里面）
  for (const device of world.ordered) {
    if (device.kind === 'rack') drawRackFrame(ctx, params, device, occupancy);
  }

  // ── 设备卡片
  for (const device of world.ordered) drawDeviceCard(ctx, frameParams, device);

  // ── 机柜的标题栏与翻转按钮画在卡片上层（否则会被柜内设备盖住）
  for (const device of world.ordered) {
    if (device.kind === 'rack') drawRackHeader(ctx, params, device, occupancy);
  }

  // ── 端口图元（画在卡片上层，并补齐"端口 → 卡片底边"的引出线）
  for (const device of world.ordered) drawPortStrip(ctx, frameParams, device);

  // ── 文字层：连线速率标签 + 流向动画的文案，必须**始终在设备卡片之上**（FR-44）
  //     用户反馈：标签被后画的卡片盖住 —— 根因是标签与线体在同一趟绘制，而卡片在其后
  for (const link of world.links) drawCable(ctx, frameParams, link, 'label');
  if (params.flow) drawFlow(ctx, params, params.flow, 'over');

  // ── 框选矩形
  if (params.marquee) {
    const topLeft = worldToScreen(camera, params.marquee.x, params.marquee.y);
    const w = params.marquee.w * camera.k;
    const h = params.marquee.h * camera.k;
    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(topLeft.x, topLeft.y, w, h);
    ctx.strokeRect(topLeft.x, topLeft.y, w, h);
    ctx.restore();
  }

  ctx.restore();
}

/* ────────────────────────────── 链路 ────────────────────────────── */

function drawCable(
  ctx: CanvasRenderingContext2D,
  params: DrawParams,
  link: DerivedLink,
  phase: 'stroke' | 'label',
): void {
  const { world, camera } = params;
  // 带摆动偏移的路径：线体、标签、警示点看到的是同一条曲线，
  // 拖拽时标签不会与线体分离（FR-50）；同帧内复用（FR-56）
  const cached = params.cablePaths?.get(link.id);
  const path = cached !== undefined ? cached : linkPath(world, link, params.cableSway?.get(link.id));
  if (!path) return;

  // 标签走"上层文字趟"，与线体分开绘制
  if (phase === 'label') {
    // 缩得太小时标签会糊成一片：只保留选中/在诊断路径上的那些（LOD）
    if (!cableLabelVisible(link.id, camera, [...params.selection.cables, ...params.pathLinkIds])) {
      return;
    }
    const anchor = worldToScreen(camera, path.labelPoint.x, path.labelPoint.y);
    const label = labelText(link);
    // 悬浮 / 拖动中的标签加高亮环：否则用户不知道这个东西能拖（FR-46）
    const active = params.activeLabelId === link.id;
    drawSpeedBadge(ctx, anchor, label, link.up ? link.speedMbps : null, active);

    if (link.issues.some((issue) => issue.level === 'warn')) {
      const warning = worldToScreen(camera, path.labelPoint.x, path.labelPoint.y + 22);
      ctx.save();
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(warning.x, warning.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return;
  }

  const inPath = params.pathLinkIds.includes(link.id);
  const selected = params.selection.cables.includes(link.id);
  const wireless = link.family === 'wireless';

  // 速率配色：链路本体用弱化色，标签用实色（FR-34）
  const baseColor = link.up
    ? inPath
      ? '#4ade80'
      : speedColorAlpha(link.speedMbps, 0.75)
    : '#ef4444';

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(wireless ? [7, 6] : []);

  // 外描边：让电缆在深色背景上有体积感（结构档位下省掉，800 条线时它是纯开销）
  if (!wireless && camera.k >= LOD_STRUCTURE) {
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.lineWidth = (inPath ? 7 : selected ? 6.5 : 5) * Math.min(1.2, Math.max(0.6, camera.k));
    strokePolyline(ctx, path.points, camera);
  }

  ctx.strokeStyle = baseColor;
  ctx.lineWidth =
    (inPath ? 4 : selected ? 3.5 : 2.4) * Math.min(1.2, Math.max(0.6, camera.k)) *
    (camera.k < LOD_STRUCTURE ? 0.5 : 1);
  strokePolyline(ctx, path.points, camera);

  if (selected) {
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const point of [path.from, ...path.points, path.to]) {
      const screen = worldToScreen(camera, point.x, point.y);
      ctx.lineTo(screen.x, screen.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function strokePolyline(ctx: CanvasRenderingContext2D, points: Point[], camera: Viewport): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    const screen = worldToScreen(camera, point.x, point.y);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.stroke();
}

/** 速率标签：边框与文字都用速率色（带宽越高越绿）；`active` 时加一圈高亮表示可拖动 */
function drawSpeedBadge(
  ctx: CanvasRenderingContext2D,
  at: Point,
  text: string,
  speedMbps: number | null,
  active = false,
): void {
  const color = speedMbps === null ? '#fca5a5' : speedColor(speedMbps);
  ctx.save();
  ctx.font = LABEL_FONT;
  const width = ctx.measureText(text).width + LABEL_PAD_X * 2;
  const height = LABEL_HEIGHT;

  if (active) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    roundRect(ctx, at.x - width / 2 - 4, at.y - height / 2 - 4, width + 8, height + 8, 7);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  roundRect(ctx, at.x - width / 2, at.y - height / 2, width, height, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y + 0.5);
  ctx.restore();
}

/* ────────────────────────────── 流向动画 ────────────────────────────── */

function drawFlow(
  ctx: CanvasRenderingContext2D,
  params: DrawParams,
  flow: FlowView,
  phase: 'under' | 'over',
): void {
  const { camera } = params;
  const { path } = flow;
  const failed = path.kind === 'failed';
  const color = failed ? '#f87171' : '#22d3ee';

  // 文案层：阻断点提示与底部速率提示，画在卡片之上
  if (phase === 'over') {
    if (flow.stopped && path.stopAt !== null) {
      const end = pointAt(path, path.stopAt);
      const screen = worldToScreen(camera, end.x, end.y);
      drawSpeedBadge(ctx, { x: screen.x, y: screen.y - 30 }, '数据到此中断', null);
    }
    const bottleneckText =
      path.minSpeedMbps > 0 ? `最慢一跳 ${formatSpeed(path.minSpeedMbps)}` : '速率未协商';
    const hint =
      flow.activeHop === null ? bottleneckText : `第 ${flow.activeHop + 1} 跳 · ${bottleneckText}`;
    ctx.save();
    ctx.font = `600 11px ${UI_FONT}`;
    const width = ctx.measureText(hint).width + 16;
    ctx.fillStyle = 'rgba(12, 74, 110, 0.92)';
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.5)';
    ctx.lineWidth = 1;
    roundRect(ctx, 16, params.height - 34, width, 20, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#bae6fd';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(hint, 24, params.height - 23.5);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  path.points.forEach((point, index) => {
    const screen = worldToScreen(camera, point.x, point.y);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.stroke();
  ctx.restore();

  // 方向箭头：沿弧长等距铺开
  const arrowCount = Math.max(1, Math.floor(path.total / 78));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 1; i <= arrowCount; i += 1) {
    const at = (path.total / (arrowCount + 1)) * i;
    const head = pointAt(path, at + 6);
    const tail = pointAt(path, at - 6);
    const angle = Math.atan2(head.y - tail.y, head.x - tail.x);
    const screen = worldToScreen(camera, head.x, head.y);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-7, -4.3);
    ctx.lineTo(0, 0);
    ctx.lineTo(-7, 4.3);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // 粒子
  const radius = 3.4 * Math.min(1.3, Math.max(0.75, camera.k));
  for (const distance of flow.distances) {
    const point = pointAt(path, distance);
    const screen = worldToScreen(camera, point.x, point.y);
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 阻断点
  if (flow.stopped && path.stopAt !== null) {
    const end = pointAt(path, path.stopAt);
    const screen = worldToScreen(camera, end.x, end.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 8 + flow.pulse * 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1 - flow.pulse;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ────────────────────────────── 网格 / 卡片 ────────────────────────────── */

function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Viewport,
  width: number,
  height: number,
): void {
  const step = 40 * camera.k;
  if (step < 8) return;
  const offsetX = camera.x % step;
  const offsetY = camera.y % step;
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = offsetX; x < width; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = offsetY; y < height; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

function drawDeviceCard(
  ctx: CanvasRenderingContext2D,
  params: DrawParams,
  device: Device,
): void {
  const { camera, world } = params;
  // 画不到的设备直接跳过（800 台设备 + 放大到一台机柜时，这一条省掉九成开销）
  if (!boxInView(hitRect(device), params)) return;
  const at = worldToScreen(camera, device.x, device.y);
  const w = cardWidthOf(device) * camera.k;
  const cardHeight = cardHeightOf(device);
  const h = cardHeight * camera.k;
  const accent = KIND_COLOR[device.kind];
  const selected = params.selection.devices.includes(device.id);
  const portSelected = params.selection.port?.deviceId === device.id;
  const inPath = params.pathDeviceIds.includes(device.id);
  const addresses = world.addresses.get(device.id) ?? [];
  // 有背板端口的设备悬浮时半透明（FR-48）：与机柜悬浮同一套"透视"约定
  const hovered = params.hoverDeviceId === device.id;

  ctx.save();
  ctx.globalAlpha = hovered ? HOVER_FADE : 1;

  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = selected || portSelected ? '#facc15' : inPath ? '#4ade80' : '#1e293b';
  ctx.lineWidth = selected || portSelected || inPath ? 2.5 : 1.5;
  roundRect(ctx, at.x, at.y, w, h, 10);
  ctx.fill();
  ctx.stroke();

  if ((selected || portSelected) && params.selection.devices.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    roundRect(ctx, at.x - 4, at.y - 4, w + 8, h + 8, 12);
    ctx.stroke();
    ctx.restore();
  }

  // 结构档位：只画卡片框与左侧色条 —— 缩到 13% 时卡片只有 20 px 宽，画细节没有意义
  if (camera.k < LOD_STRUCTURE) {
    ctx.save();
    roundRect(ctx, at.x, at.y, w, h, 10);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.fillRect(at.x, at.y, Math.max(1.5, 4 * camera.k), h);
    ctx.restore();
    ctx.restore();
    return;
  }

  // 左侧色条 + 端口面板底色（端口画在面板上，所以面板区有独立底色）
  const band = panelBand(device);
  ctx.save();
  roundRect(ctx, at.x, at.y, w, h, 10);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.fillRect(at.x, at.y, 5 * camera.k, h);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.07)';
  ctx.fillRect(at.x, at.y + (band.top - device.y) * camera.k, w, band.height * camera.k);
  ctx.restore();

  // 图标
  const iconSize = 19 * camera.k;
  strokeIcon(
    ctx,
    deviceIcon(device.kind, device.subtype),
    at.x + 13 * camera.k + iconSize / 2,
    at.y + 17 * camera.k,
    iconSize,
    accent,
    2,
  );

  // 名称
  ctx.font = `600 ${Math.round(12.5 * camera.k)}px ${UI_FONT}`;
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    truncate(ctx, device.name, w - 56 * camera.k),
    at.x + 42 * camera.k,
    at.y + 9 * camera.k,
  );

  // 类型 · 子类型
  const kindText = device.subtype
    ? `${DEVICE_KIND_LABEL[device.kind]} · ${DEVICE_SUBTYPE_LABEL[device.subtype]}`
    : DEVICE_KIND_LABEL[device.kind];
  ctx.font = `400 ${Math.round(9.5 * camera.k)}px ${UI_FONT}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(
    truncate(ctx, kindText, w - 56 * camera.k),
    at.x + 42 * camera.k,
    at.y + 25 * camera.k,
  );

  // 地址摘要
  const addressText =
    addresses.length > 0
      ? addresses
          .map((address) => `${address.ip}/${address.prefix}`)
          .slice(0, 2)
          .join('  ')
      : world.leases.get(device.id)?.failure
        ? '无地址（DHCP 失败）'
        : '未配置地址';
  ctx.font = `400 ${Math.round(10 * camera.k)}px ${MONO_FONT}`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(
    truncate(ctx, addressText, w - 24 * camera.k),
    at.x + 12 * camera.k,
    at.y + 41 * camera.k,
  );

  // 多 U 设备：在头部下方补上"占几 U / 第几 U / 型号"
  const units = rackUnitsOf(device);
  if (units > DEFAULT_RACK_UNITS) {
    const lines = [
      `${units}U 设备${device.mount ? ` · 第 ${device.mount.startU}–${device.mount.startU + units - 1}U` : ''}`,
      device.model ?? '',
    ].filter((line) => line.length > 0);
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(at.x + 12 * camera.k, (PANEL_HEADER_H - 2) * camera.k + at.y);
    ctx.lineTo(at.x + w - 12 * camera.k, (PANEL_HEADER_H - 2) * camera.k + at.y);
    ctx.stroke();
    ctx.font = `400 ${Math.round(9.5 * camera.k)}px ${UI_FONT}`;
    ctx.fillStyle = '#64748b';
    lines.forEach((line, index) => {
      ctx.fillText(
        truncate(ctx, line, w - 24 * camera.k),
        at.x + 12 * camera.k,
        at.y + (58 + index * 14) * camera.k,
      );
    });
    ctx.restore();
  }

  // 设备自身的翻转按钮：只有"有背板端口且未上架"的设备才需要
  // （上架设备的观察面跟随机柜，翻转机柜即翻转柜内所有设备）
  if (hasRearPorts(device) && !device.mount && params.world.devices.size > 0) {
    const rect = deviceFlipButtonRect({ x: device.x, y: device.y, w: cardWidthOf(device) });
    const buttonAt = worldToScreen(camera, rect.x, rect.y);
    const buttonW = rect.w * camera.k;
    const buttonH = rect.h * camera.k;
    const flipped = deviceSide(device, false) === 'rear';
    const pointerOver =
      params.cursor !== null &&
      params.cursor.x >= buttonAt.x - 3 &&
      params.cursor.x <= buttonAt.x + buttonW + 3 &&
      params.cursor.y >= buttonAt.y - 3 &&
      params.cursor.y <= buttonAt.y + buttonH + 3;

    /*
     * 当前观察面**只用颜色表达**（FR-52）：按钮边框就是原来那行"正面/背面"文字的颜色。
     * 卡片上因此少了一行常驻文字，而"现在看的是哪一面"仍然一眼可见；
     * 具体是哪一面写在按钮的悬浮提示里，鼠标移上去就有（不占常驻版面）。
     */
    const sideColor = flipped ? SIDE_COLOR_REAR : SIDE_COLOR_FRONT;

    ctx.save();
    ctx.fillStyle = pointerOver ? 'rgba(56, 189, 248, 0.3)' : 'rgba(51, 65, 85, 0.85)';
    roundRect(ctx, buttonAt.x, buttonAt.y, buttonW, buttonH, 4);
    ctx.fill();
    ctx.strokeStyle = sideColor;
    ctx.lineWidth = pointerOver ? 2 : 1.5;
    ctx.stroke();
    strokeIcon(
      ctx,
      uiIcon('flip'),
      buttonAt.x + buttonW / 2,
      buttonAt.y + buttonH / 2,
      Math.min(buttonW, buttonH) * 0.62,
      pointerOver ? '#e0f2fe' : sideColor,
      2,
    );
    ctx.restore();

    if (pointerOver) {
      drawPortTooltip(
        ctx,
        { x: buttonAt.x + buttonW / 2, y: buttonAt.y + buttonH + 14 },
        flipTooltipText(flipped),
      );
    }
  }

  /*
   * 宽度拖拽把手（FR-49）：只在"指针已经贴到右边缘"或正在拖拽时出现。
   * 常驻显示会让每张卡片都多一块装饰 —— 这里的取舍是"提示按需出现"。
   */
  const resizeEdge = params.resizeHandleId === device.id ? cardResizeEdge(device) : null;
  if (resizeEdge) {
    const edge = resizeEdge;
    const gripX = worldToScreen(camera, edge.x, 0).x;
    const gripTop = worldToScreen(camera, 0, edge.top).y;
    const gripBottom = worldToScreen(camera, 0, edge.bottom).y;
    const midY = (gripTop + gripBottom) / 2;
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const offset of [-5, 0, 5]) {
      ctx.moveTo(gripX, midY + offset * camera.k - 5 * camera.k);
      ctx.lineTo(gripX, midY + offset * camera.k + 5 * camera.k);
    }
    ctx.stroke();
    // 边缘本身也点亮，明确"拖的是这条边"
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(gripX, gripTop);
    ctx.lineTo(gripX, gripBottom);
    ctx.stroke();
    ctx.restore();
  }

  // 诊断路径序号
  const stepNo = params.pathStepByDevice.get(device.id);
  if (stepNo !== undefined) {
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(at.x + w - 13 * camera.k, at.y + 13 * camera.k, 8.5 * camera.k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#052e16';
    ctx.font = `700 ${Math.round(10.5 * camera.k)}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(stepNo), at.x + w - 13 * camera.k, at.y + 14 * camera.k);
  }

  ctx.restore();
}

/* ────────────────────────────── 端口条带 ────────────────────────────── */

function portLink(world: World, deviceId: string, portId: string): DerivedLink | undefined {
  const links = world.linksByPort.get(`${deviceId}:${portId}`) ?? [];
  return [...links].sort((a, b) => a.id.localeCompare(b.id))[0];
}

function drawPortStrip(
  ctx: CanvasRenderingContext2D,
  params: DrawParams,
  device: Device,
): void {
  const { world, camera } = params;
  // 端口图元在低缩放下只有 1 px：直接跳过（LOD）
  if (camera.k < LOD_DETAIL) return;
  if (!boxInView(hitRect(device), params)) return;
  const all = portLayout(device);
  if (all.length === 0) return;

  // 已上架的设备只显示与当前观察面一致的端口；
  // 其所在机柜被悬浮、或**这台设备本身被悬浮**时，把另一面的端口以幽灵形式画出来
  // （"透视"看到背面，FR-48）
  const rack = device.mount ? world.devices.get(device.mount.rackId) : undefined;
  const flipped = rack?.rack?.flipped ?? false;
  // 上架设备跟随机柜，未上架设备用自身的翻转状态
  const side = deviceSide(device, flipped);
  const ghostSide: 'front' | 'rear' = side === 'front' ? 'rear' : 'front';
  const showGhost =
    (Boolean(rack) && params.hoverRackId === rack?.id) || params.hoverDeviceId === device.id;

  if (showGhost) {
    for (const glyph of all) {
      if (portSide(glyph.port) !== ghostSide) continue;
      drawPortShape(ctx, glyph, camera, {
        medium: glyph.port.medium,
        linked: true,
        up: true,
        speedMbps: 0,
        active: false,
        hover: false,
        ghost: true,
      });
    }
  }

  for (const glyph of visiblePortGlyphs(device, side)) {
    const link = portLink(world, device.id, glyph.port.id);
    const isDraft =
      params.linkDraft?.deviceId === device.id && params.linkDraft.portId === glyph.port.id;
    const isHover =
      params.hoverPort?.deviceId === device.id && params.hoverPort.portId === glyph.port.id;
    const isSelected =
      params.selection.port?.deviceId === device.id &&
      params.selection.port.portId === glyph.port.id;

    // 端口与卡片底边之间的引出线：让"这根电缆插在这个口上"一眼可见
    if (link && glyph.anchorY > glyph.centerY + 1) {
      const tailTop = worldToScreen(camera, glyph.centerX, glyph.centerY);
      const tailBottom = worldToScreen(camera, glyph.centerX, glyph.anchorY);
      ctx.save();
      ctx.strokeStyle = link.up ? speedColorAlpha(link.speedMbps, 0.8) : '#ef4444';
      ctx.lineWidth = 2 * Math.min(1.2, Math.max(0.7, camera.k));
      ctx.beginPath();
      ctx.moveTo(tailTop.x, tailTop.y);
      ctx.lineTo(tailBottom.x, tailBottom.y);
      ctx.stroke();
      ctx.restore();
    }

    drawPortShape(ctx, glyph, camera, {
      medium: glyph.port.medium,
      linked: link !== undefined,
      up: link?.up ?? true,
      speedMbps: link?.speedMbps ?? 0,
      active: isDraft || isSelected,
      hover: isHover,
    });

    if (glyph.showLabel && camera.k > 0.72) {
      const center = worldToScreen(camera, glyph.centerX, glyph.y + glyph.h + 6.5);
      ctx.save();
      ctx.font = `500 ${Math.round(7 * camera.k)}px ${UI_FONT}`;
      // 标签比"图元宽度 + 间隙"还宽就不画，否则相邻端口会互相压字
      // （名字在悬停提示与端口详情里都能看到）
      const labelWidth = ctx.measureText(glyph.port.name).width / camera.k;
      const available = glyph.w + 2.4;
      if (labelWidth <= available) {
        ctx.fillStyle = isHover || isDraft ? '#e2e8f0' : '#7c8ba1';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph.port.name, center.x, center.y);
      }
      ctx.restore();
    }

    // 悬停时在端口上方显示名称与速率，弥补小图元看不清的问题
    if (isHover || isDraft || isSelected) {
      const top = worldToScreen(camera, glyph.centerX, glyph.y - 12);
      const text = link
        ? `${glyph.port.name} · ${link.up ? formatSpeed(link.speedMbps) : '不可用'}`
        : glyph.port.name;
      drawPortTooltip(ctx, top, text);
    }
  }
}

interface PortShapeState {
  medium: PortMedium;
  linked: boolean;
  up: boolean;
  speedMbps: number;
  active: boolean;
  hover: boolean;
  /** 幽灵：机柜另一面的端口，以低透明度显示，表示"透过面板看到" */
  ghost?: boolean;
}

/** 按介质画出端口形状：网口是 RJ45 梯形缺口，光口是光笼，PON 是带芯的光口，无线是天线 */
function drawPortShape(
  ctx: CanvasRenderingContext2D,
  glyph: PortGlyph,
  camera: Viewport,
  state: PortShapeState,
): void {
  const at = worldToScreen(camera, glyph.x, glyph.y);
  const w = glyph.w * camera.k;
  const h = glyph.h * camera.k;
  if (w < 2 || h < 2) return;

  const stroke = state.active
    ? '#facc15'
    : state.hover
      ? '#38bdf8'
      : !state.linked
        ? '#64748b'
        : state.up
          ? speedColor(state.speedMbps)
          : '#ef4444';
  const fill = state.linked && state.up ? speedColorAlpha(state.speedMbps, 0.22) : 'rgba(15, 23, 42, 0.55)';

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, 1.3 * Math.min(1.2, Math.max(0.7, camera.k)));
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  if (state.ghost) {
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = '#94a3b8';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
  }

  switch (state.medium) {
    case 'rj45': {
      // RJ45 网口：下方矩形 + 顶部卡扣缺口（与设备面板上的网口形状一致）
      const bodyTop = at.y + h * 0.3;
      ctx.beginPath();
      ctx.moveTo(at.x, at.y + h);
      ctx.lineTo(at.x, bodyTop + h * 0.18);
      ctx.quadraticCurveTo(at.x, bodyTop, at.x + w * 0.16, bodyTop);
      ctx.lineTo(at.x + w * 0.3, bodyTop);
      ctx.lineTo(at.x + w * 0.36, at.y);
      ctx.lineTo(at.x + w * 0.64, at.y);
      ctx.lineTo(at.x + w * 0.7, bodyTop);
      ctx.lineTo(at.x + w * 0.84, bodyTop);
      ctx.quadraticCurveTo(at.x + w, bodyTop, at.x + w, bodyTop + h * 0.18);
      ctx.lineTo(at.x + w, at.y + h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'sfp': {
      // 光笼：外壳矩形 + 内部插槽
      roundRect(ctx, at.x, at.y, w, h, Math.min(2.5, w * 0.12));
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(at.x + w * 0.16, at.y + h * 0.34, w * 0.68, h * 0.42);
      ctx.stroke();
      break;
    }
    case 'pon': {
      // PON 光口：光笼 + 中央光纤芯
      roundRect(ctx, at.x, at.y, w, h, Math.min(2.5, w * 0.12));
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(at.x + w / 2, at.y + h / 2, Math.min(w, h) * 0.2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'wifi': {
      // 无线：天线杆 + 两道辐射弧
      const cx = at.x + w / 2;
      const baseY = at.y + h;
      ctx.beginPath();
      ctx.moveTo(cx, baseY);
      ctx.lineTo(cx, at.y + h * 0.42);
      ctx.stroke();
      for (const scale of [0.42, 0.72]) {
        ctx.beginPath();
        ctx.arc(cx, at.y + h * 0.42, w * scale * 0.6, Math.PI * 1.18, Math.PI * 1.82);
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }

  ctx.restore();
}

function drawPortTooltip(ctx: CanvasRenderingContext2D, at: Point, text: string): void {
  ctx.save();
  ctx.font = `600 10px ${UI_FONT}`;
  const width = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(2, 6, 23, 0.94)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 1;
  roundRect(ctx, at.x - width / 2, at.y - 9, width, 17, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y);
  ctx.restore();
}

/* ────────────────────────────── 机柜容器（FR-36） ────────────────────────────── */

/** 机柜内每个"起始 U → 占用 U 数"，用于画跨格的高亮带 */
/** 单个机柜的占用表（导出给测试用；绘制走 drawScene 每帧一次的共享表） */
export function slotOccupancy(world: World, rackId: string): Map<number, number> {
  const occupied = new Map<number, number>();
  for (const device of world.ordered) {
    if (device.mount?.rackId === rackId) {
      occupied.set(device.mount.startU, rackUnitsOf(device));
    }
  }
  return occupied;
}

/** 某个 U 格是否被占用（含被多 U 设备跨占的情况） */
function slotIsOccupied(occupied: Map<number, number>, slot: number): boolean {
  for (const [startU, units] of occupied) {
    if (slot >= startU && slot < startU + units) return true;
  }
  return false;
}

function drawRackFrame(
  ctx: CanvasRenderingContext2D,
  params: DrawParams,
  rack: Device,
  occupancy: Map<string, Map<number, number>>,
): void {
  if (!rack.rack) return;
  if (!boxInView(rackRect(rack), params)) return;
  const { camera } = params;
  // 结构档位：机柜只画外框（42 个 U 位格 × 72 个机柜 = 三千多个矩形，低缩放下全是浪费）
  const structural = camera.k < LOD_DETAIL;
  const total = rackHeightU(rack);
  const flipped = rack.rack.flipped;
  const hovered = params.hoverRackId === rack.id;
  // 占用表由 drawScene 每帧算一次（每个机柜各扫一遍全部设备是 O(机柜×设备) 的浪费）
  const occupied = occupancy.get(rack.id) ?? new Map<number, number>();

  const at = worldToScreen(camera, rack.x, rack.y);
  const w = RACK_W * camera.k;
  const h = rackHeight(rack) * camera.k;
  const selected = params.selection.devices.includes(rack.id);

  ctx.save();
  // 悬浮 → 半透明，可以看到机柜另一面的端口
  ctx.globalAlpha = hovered ? HOVER_FADE : 1;

  // 柜体
  ctx.fillStyle = hovered ? '#0a0f1d' : '#0b1220';
  ctx.strokeStyle = selected || hovered ? '#38bdf8' : '#334155';
  ctx.lineWidth = selected ? 2.5 : 1.6;
  roundRect(ctx, at.x, at.y, w, h, 8);
  ctx.fill();
  ctx.stroke();

  // 内部面板（背面用不同的底纹，让"翻到背面"看得出来）
  const panelX = at.x + RACK_PAD_X * camera.k;
  const panelY = at.y + RACK_HEADER_H * camera.k;
  const panelW = (RACK_W - RACK_PAD_X * 2) * camera.k;
  const panelH = (h / camera.k - RACK_HEADER_H - 12) * camera.k;
  ctx.save();
  ctx.fillStyle = flipped ? 'rgba(30, 41, 59, 0.55)' : 'rgba(15, 23, 42, 0.75)';
  roundRect(ctx, panelX, panelY, panelW, panelH, 4);
  ctx.fill();
  ctx.restore();

  // 结构档位到此为止：导轨、U 位格、占用带都省掉
  if (structural) {
    ctx.restore();
    return;
  }

  // 左右导轨
  ctx.save();
  ctx.fillStyle = 'rgba(51, 65, 85, 0.75)';
  ctx.fillRect(at.x + RACK_PAD_X * camera.k, panelY, RACK_RAIL_W * camera.k, panelH);
  ctx.fillRect(
    at.x + (RACK_W - RACK_PAD_X - RACK_RAIL_W) * camera.k,
    panelY,
    RACK_RAIL_W * camera.k,
    panelH,
  );
  ctx.restore();

  // U 位：空位画虚线槽，已占用画高亮槽
  for (let u = 1; u <= total; u += 1) {
    const top = worldToScreen(camera, rack.x, rack.y + RACK_HEADER_H + (u - 1) * RACK_UNIT_H);
    const slotH = (RACK_UNIT_H - 6) * camera.k;
    const used = slotIsOccupied(occupied, u);
    ctx.save();
    if (used) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.07)';
      roundRect(ctx, panelX + RACK_RAIL_W * camera.k, top.y + 3 * camera.k, panelW - RACK_RAIL_W * 2 * camera.k, slotH, 3);
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(panelX + RACK_RAIL_W * camera.k, top.y + RACK_UNIT_H * camera.k * 0.5);
      ctx.lineTo(panelX + panelW - RACK_RAIL_W * camera.k, top.y + RACK_UNIT_H * camera.k * 0.5);
      ctx.stroke();
    }
    if (camera.k > 0.5) {
      ctx.setLineDash([]);
      ctx.font = `500 ${Math.round(8 * camera.k)}px ${UI_FONT}`;
      ctx.fillStyle = used ? '#7dd3fc' : '#475569';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        String(u),
        at.x + (RACK_PAD_X + RACK_RAIL_W / 2) * camera.k,
        top.y + (RACK_UNIT_H / 2) * camera.k,
      );
    }
    ctx.restore();
  }

  // 立柱纹理：正面竖线、背面横纹，视觉上区分两面
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  if (flipped) {
    for (let y = panelY; y < panelY + panelH; y += 7 * camera.k) {
      ctx.beginPath();
      ctx.moveTo(panelX, y);
      ctx.lineTo(panelX + panelW, y);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.restore();
}

/** 机柜标题栏 + 翻转按钮（画在所有卡片之上，保证按钮可点） */
function drawRackHeader(
  ctx: CanvasRenderingContext2D,
  params: DrawParams,
  rack: Device,
  occupancy: Map<string, Map<number, number>>,
): void {
  if (!rack.rack) return;
  if (!boxInView(rackRect(rack), params)) return;
  const { camera } = params;
  const at = worldToScreen(camera, rack.x, rack.y);
  const w = RACK_W * camera.k;
  const headerH = RACK_HEADER_H * camera.k;
  const hovered = params.hoverRackId === rack.id;
  const flipped = rack.rack.flipped;
  // 已用 U 数按占用高度累加（2U 设备算 2U）
  const usedCount = [...(occupancy.get(rack.id) ?? new Map<number, number>()).values()].reduce(
    (sum, units) => sum + units,
    0,
  );

  ctx.save();
  ctx.fillStyle = hovered ? 'rgba(12, 74, 110, 0.95)' : 'rgba(15, 23, 42, 0.96)';
  roundRect(ctx, at.x, at.y, w, headerH, 8);
  ctx.fill();
  ctx.strokeStyle = hovered ? '#38bdf8' : '#334155';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 翻转按钮先算出来（标题要避开它）
  const button = rackFlipButtonRect(rack);
  const buttonAt = worldToScreen(camera, button.x, button.y);
  const buttonW = button.w * camera.k;
  const buttonH = button.h * camera.k;

  // 当前观察面只用按钮边框的颜色表达（FR-52），卡片上不再常驻"正面/背面"文字；
  // 名称于是可以用到按钮左侧为止（此前要给那行文字让位）
  const sideColor = flipped ? SIDE_COLOR_REAR : SIDE_COLOR_FRONT;
  const gap = 10 * camera.k;
  ctx.font = `600 ${Math.round(11 * camera.k)}px ${UI_FONT}`;
  ctx.fillStyle = '#e2e8f0';
  const nameMax = buttonAt.x - gap - (at.x + 10 * camera.k);
  // 名称不再拼"· 12U"：模板名里通常已含高度，占用情况放在底部信息栏
  ctx.fillText(
    truncate(ctx, rack.name, nameMax),
    at.x + 10 * camera.k,
    at.y + headerH / 2,
  );

  // 翻转按钮：图标化（不再用文字），悬浮时高亮
  const pointerOverButton =
    params.cursor !== null &&
    params.cursor.x >= buttonAt.x - 3 &&
    params.cursor.x <= buttonAt.x + buttonW + 3 &&
    params.cursor.y >= buttonAt.y - 3 &&
    params.cursor.y <= buttonAt.y + buttonH + 3;

  ctx.fillStyle = pointerOverButton
    ? 'rgba(56, 189, 248, 0.3)'
    : hovered
      ? 'rgba(56, 189, 248, 0.16)'
      : 'rgba(51, 65, 85, 0.9)';
  roundRect(ctx, buttonAt.x, buttonAt.y, buttonW, buttonH, 4);
  ctx.fill();
  ctx.strokeStyle = sideColor;
  ctx.lineWidth = pointerOverButton ? 2 : 1.5;
  ctx.stroke();

  strokeIcon(
    ctx,
    uiIcon('flip'),
    buttonAt.x + buttonW / 2,
    buttonAt.y + buttonH / 2,
    Math.min(buttonW, buttonH) * 0.62,
    pointerOverButton ? '#e0f2fe' : sideColor,
    2,
  );

  // 按钮悬浮提示：图标本身不写文字，"现在看的是哪一面"写在这里（FR-52）
  if (pointerOverButton) {
    drawPortTooltip(
      ctx,
      { x: buttonAt.x + buttonW / 2, y: buttonAt.y + buttonH + 14 },
      flipped ? '当前：背面 · 点击看正面' : '当前：正面 · 点击看背面',
    );
  }

  // 底部占用信息
  ctx.font = `400 ${Math.round(9 * camera.k)}px ${UI_FONT}`;
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'left';
  ctx.fillText(
    `${usedCount}/${rack.rack.heightU}U 已用`,
    at.x + 10 * camera.k,
    at.y + rackHeight(rack) * camera.k - 6 * camera.k,
  );
  ctx.restore();
}

/* ────────────────────────────── 小工具 ────────────────────────────── */

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export type { Port, PortGlyph };
