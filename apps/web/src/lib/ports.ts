/**
 * 端口图元布局（FR-32）
 *
 * 端口不再是"选中设备后才出现的小方块"，而是设备卡片底部常驻的**端口条带**：
 * 每个端口画成一个端口形状（RJ45 网口 / SFP 光笼 / PON 口 / 无线天线），
 * 可以直接点击选中并编辑，也可以作为连线的起点与终点。
 *
 * 布局是纯几何计算：尺寸分档 + 自动换行，保证 5 口交换机与 26 口交换机
 * 都用同一套代码排得下。
 */

import type { Device, Port } from '@toposmith/schema';
import { DEFAULT_RACK_UNITS, cardHeightOf, cardWidthOf, rackUnitsOf } from './geometry';

/**
 * 卡片头部（图标 · 名称 · 类型 · 地址）占用的高度。
 * 端口**面板**从这条线以下开始 —— 端口画在面板上，而不是挤在卡片底边。
 */
export const PANEL_HEADER_H = 54;
/** 多 U 卡片额外留给「占几 U / 第几 U / 型号」两行的高度 */
export const PANEL_HEADER_EXTRA_H = 42;
/** 面板底部留白 */
export const PANEL_BOTTOM_PAD = 8;
/** 面板左右留白 */
const STRIP_PAD = 8;

export interface PanelBand {
  top: number;
  height: number;
  cardHeight: number;
}

/** 端口面板区域：头部之下、底边之上的一段 */
export function panelBand(device: Device): PanelBand {
  const cardHeight = cardHeightOf(device);
  const extraHeader = rackUnitsOf(device) > DEFAULT_RACK_UNITS ? PANEL_HEADER_EXTRA_H : 0;
  const header = PANEL_HEADER_H + extraHeader;
  return {
    top: device.y + header,
    height: Math.max(20, cardHeight - header - PANEL_BOTTOM_PAD),
    cardHeight,
  };
}

/** 该设备当前应当显示哪一面（上架设备跟随机柜，未上架设备用自身翻转状态） */
export function deviceSide(device: Device, rackFlipped: boolean): 'front' | 'rear' {
  if (device.mount) return rackFlipped ? 'rear' : 'front';
  return device.flipped ? 'rear' : 'front';
}

/** 该设备是否两面都有端口（只有这种情况才需要翻转查看） */
export function hasBothSides(device: Device): boolean {
  return device.ports.some((port) => (port.side ?? 'front') === 'front')
    && device.ports.some((port) => port.side === 'rear');
}

/** 该设备是否有背板端口（有就给它一个翻转按钮） */
export function hasRearPorts(device: Device): boolean {
  return device.ports.some((port) => port.side === 'rear');
}

export interface PortGlyph {
  port: Port;
  /** 图元矩形（世界坐标，左上角） */
  x: number;
  y: number;
  w: number;
  h: number;
  centerX: number;
  centerY: number;
  /** 卡片底边 Y —— 连线从这里接入，端口与连线之间由一段"引出线"衔接 */
  anchorY: number;
  /** 是否在下方绘制端口名（端口少且图元够宽时） */
  showLabel: boolean;
  row: number;
}

interface SizeTier {
  w: number;
  h: number;
  gap: number;
  /** 允许的最大行数 */
  maxRows: number;
}

/** 尺寸分档：端口越多图元越小，最多两行 */
const TIERS: SizeTier[] = [
  { w: 20, h: 15, gap: 5, maxRows: 1 },
  { w: 15, h: 14, gap: 4, maxRows: 1 },
  { w: 11.5, h: 12, gap: 3, maxRows: 2 },
  { w: 8.5, h: 9.5, gap: 2, maxRows: 2 },
  { w: 7, h: 8, gap: 1.5, maxRows: 3 },
];

function capacityOf(tier: SizeTier, available: number): number {
  return Math.max(1, Math.floor((available + tier.gap) / (tier.w + tier.gap)));
}

/**
 * 端口布局缓存（**按设备对象身份**）。
 *
 * 布局是一套分档 + 换行的几何计算，但它在一次连线求路径、一次端口命中、
 * 一次卡片绘制里会被反复问同一个设备；800 台设备的场景下，一帧里
 * `portGlyphOf`/`visiblePortGlyphs` 会被调用上千次 —— 不缓存就是几万次重复计算。
 *
 * 用 `WeakMap` 按对象身份缓存：store 的每次改动都会**克隆出新的设备对象**，
 * 于是缓存自动失效，不需要任何手工失效逻辑（这也是为什么它必须是"按身份"而不是"按 id"）。
 * 代价：**不允许在原地改 `device.ports` 之后再复用同一个对象** —— 那样缓存会失效不了。
 * 现有代码都遵守这一点（改动一律经过 store 的克隆路径）。
 */
const layoutCache = new WeakMap<Device, PortGlyph[]>();

export function portLayout(device: Device): PortGlyph[] {
  const cached = layoutCache.get(device);
  if (cached) return cached;
  const computed = computePortLayout(device);
  layoutCache.set(device, computed);
  return computed;
}

function computePortLayout(device: Device): PortGlyph[] {
  const ports = device.ports;
  if (ports.length === 0) return [];

  const n = ports.length;
  const cardWidth = cardWidthOf(device);
  const available = cardWidth - STRIP_PAD * 2;
  const band = panelBand(device);

  // 选档：同时满足「宽度放得下（行数不超上限）」与「高度放得下（含端口名标签）」
  let tier = TIERS[TIERS.length - 1] as SizeTier;
  let perRow = capacityOf(tier, available);
  let rows = Math.ceil(n / perRow);
  let showLabel = rows === 1 && tier.w >= 11.5;

  for (const candidate of TIERS) {
    const capacity = capacityOf(candidate, available);
    const needed = Math.ceil(n / capacity);
    if (needed > candidate.maxRows) continue;
    const withLabel = needed === 1 && candidate.w >= 11.5;
    const contentHeight = needed * (candidate.h + 1.5) + (withLabel ? 9 : 0);
    // 留一点宽容度：标签可以轻微压到底部留白上
    if (contentHeight > band.height + 6) continue;
    tier = candidate;
    perRow = capacity;
    rows = needed;
    showLabel = withLabel;
    break;
  }

  const rowHeight = tier.h + 1.5;
  const contentHeight = rows * rowHeight + (showLabel ? 9 : 0);
  const firstRowY = band.top + Math.max(0, (band.height - contentHeight) / 2);
  const glyphs: PortGlyph[] = [];

  ports.forEach((port, index) => {
    const row = Math.floor(index / perRow);
    const inRow = index % perRow;
    const countInRow = Math.min(perRow, n - row * perRow);
    const rowWidth = countInRow * tier.w + (countInRow - 1) * tier.gap;
    const startX = device.x + (cardWidth - rowWidth) / 2;

    const x = startX + inRow * (tier.w + tier.gap);
    const y = firstRowY + row * rowHeight;

    glyphs.push({
      port,
      x,
      y,
      w: tier.w,
      h: tier.h,
      centerX: x + tier.w / 2,
      centerY: y + tier.h / 2,
      anchorY: device.y + band.cardHeight,
      showLabel,
      row,
    });
  });

  return glyphs;
}

export function portGlyphOf(device: Device, portId: string): PortGlyph | undefined {
  return portLayout(device).find((glyph) => glyph.port.id === portId);
}

/**
 * 命中测试：图元矩形外扩少量容差，方便点击。
 *
 * 取**容差内离中心最近**的那个端口：端口密集时相邻图元的容差会互相重叠，
 * 简单地"返回第一个命中"会让用户点到隔壁端口。
 */
export function hitPortGlyph(device: Device, wx: number, wy: number, pad = 2): Port | undefined {
  let best: { port: Port; distance: number } | null = null;
  for (const glyph of portLayout(device)) {
    if (
      wx < glyph.x - pad ||
      wx > glyph.x + glyph.w + pad ||
      wy < glyph.y - pad ||
      wy > glyph.y + glyph.h + pad
    ) {
      continue;
    }
    const distance = Math.hypot(wx - glyph.centerX, wy - glyph.centerY);
    if (!best || distance < best.distance) best = { port: glyph.port, distance };
  }
  return best?.port;
}

/** 端口所属的面（缺省正面） */
export function portSide(port: Port): 'front' | 'rear' {
  return port.side ?? 'front';
}

/**
 * 该设备在当前观察面下应当显示的端口。
 *
 * 未上架的设备（不在机柜里）两面都显示；上架设备只显示与当前观察面一致的端口 ——
 * 于是"机柜正面看前面板、翻到背面看后端口"这件事是数据驱动的，而不是各画一半。
 */
export function visiblePorts(device: Device, side: 'front' | 'rear'): Port[] {
  // 两面都有端口的设备（或已上架的设备）按当前观察面过滤；只有正面的设备不受影响
  if (!device.mount && !hasRearPorts(device)) return device.ports;
  return device.ports.filter((port) => portSide(port) === side);
}

/** 按当前观察面过滤后的端口图元 */
export function visiblePortGlyphs(device: Device, side: 'front' | 'rear'): PortGlyph[] {
  if (!device.mount && !hasRearPorts(device)) return portLayout(device);
  const allowed = new Set(device.ports.filter((p) => portSide(p) === side).map((p) => p.id));
  return portLayout(device).filter((glyph) => allowed.has(glyph.port.id));
}
