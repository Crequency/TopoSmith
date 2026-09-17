/**
 * 图标（Lucide，ISC 许可，可商用、可闭源分发，无需署名到 UI）
 *
 * 为什么不用 iconfont.cn / 图标字体方案：
 *  1. Canvas 上画图标字体需要额外加载字体文件并通过私有区码位 `fillText`，
 *     字体加载失败时会静默显示成方框；而这里的图标是**几何路径数据**，
 *     可以直接构建 `Path2D` 交给 Canvas 描边，零加载、零闪烁。
 *  2. 同一份数据既能画进 Canvas，也能渲染成 SVG 组件（见 `Icon`），
 *     避免"画布上一套图标、面板里另一套图标"的漂移。
 *  3. ISC 许可是宽松许可（等价于 MIT 的宽松度），商用与再分发都没有限制。
 *
 * 数据形态：`[标签名, 属性表][]`，坐标系固定为 24×24，与 Lucide 的 SVG 一致。
 */

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Cable,
  Cctv,
  CircuitBoard,
  Cloud,
  Cpu,
  EthernetPort,
  GitFork,
  HardDrive,
  Laptop,
  Monitor,
  Pause,
  PcCase,
  Play,
  Plug,
  Printer,
  Radio,
  RadioTower,
  Redo2,
  RotateCcw,
  Router,
  Server,
  Smartphone,
  CircleHelp,
  Rotate3d,
  Tablet,
  Undo2,
  Warehouse,
  Waypoints,
  Wifi,
  type IconNode,
} from 'lucide';
import { createElement, type ReactNode } from 'react';
import type { DeviceKind, DeviceSubtype, PortMedium } from '@toposmith/schema';

/** Lucide 的图标节点数据：`[标签名, 属性][]`（直接复用官方类型，避免两套定义漂移） */
export type { IconNode };

export const ICON_VIEWBOX = 24;

/* ────────────────────────────── 设备 → 图标 ────────────────────────────── */

const KIND_ICON: Record<DeviceKind, IconNode> = {
  ont: Router, // 光猫：光网络终端 + 路由
  router: Waypoints, // 路由器：多路径转发
  switch: GitFork, // 交换机：一进多出的汇聚/分发
  computer: Monitor,
  mobile: Smartphone,
  embedded: Cpu,
  ap: Wifi, // 无线接入点
  olt: RadioTower, // 局端 OLT：接入机房的形象化
  cloud: Cloud,
  rack: Warehouse, // 机柜容器
};

const SUBTYPE_ICON: Partial<Record<DeviceSubtype, IconNode>> = {
  desktop: Monitor,
  laptop: Laptop,
  tablet: Tablet,
  'rack-server': Server,
  'tower-workstation': PcCase,
  'mini-pc': Cpu,
  phone: Smartphone,
  nas: HardDrive,
  camera: Cctv,
  printer: Printer,
  iot: Radio,
  'single-board': CircuitBoard,
};

/** 设备图标：有细分类型时优先用更具体的图标 */
export function deviceIcon(kind: DeviceKind, subtype?: DeviceSubtype): IconNode {
  if (subtype && SUBTYPE_ICON[subtype]) return SUBTYPE_ICON[subtype] as IconNode;
  return KIND_ICON[kind];
}

/* ────────────────────────────── 端口 → 图标 ────────────────────────────── */

const MEDIUM_ICON: Record<PortMedium, IconNode> = {
  rj45: EthernetPort,
  sfp: Cable,
  pon: Plug,
  wifi: Wifi,
};

export function portIcon(medium: PortMedium): IconNode {
  return MEDIUM_ICON[medium];
}

/* ────────────────────────────── 界面图标 ────────────────────────────── */

export type UiIconName =
  | 'align-left'
  | 'align-right'
  | 'align-top'
  | 'align-bottom'
  | 'align-center-x'
  | 'align-center-y'
  | 'distribute-x'
  | 'distribute-y'
  | 'play'
  | 'pause'
  | 'replay'
  | 'undo'
  | 'redo'
  | 'flip'
  | 'help';

const UI_ICON: Record<UiIconName, IconNode> = {
  'align-left': AlignStartVertical,
  'align-right': AlignEndVertical,
  'align-top': AlignStartHorizontal,
  'align-bottom': AlignEndHorizontal,
  'align-center-x': AlignCenterVertical,
  'align-center-y': AlignCenterHorizontal,
  'distribute-x': AlignHorizontalDistributeCenter,
  'distribute-y': AlignVerticalDistributeCenter,
  play: Play,
  pause: Pause,
  replay: RotateCcw,
  undo: Undo2,
  redo: Redo2,
  flip: Rotate3d, // 转动观察角度（不用相机图标）
  help: CircleHelp,
};

export function uiIcon(name: UiIconName): IconNode {
  return UI_ICON[name];
}

/* ────────────────────────────── Canvas 渲染 ────────────────────────────── */

const PATH_CACHE = new Map<IconNode, Path2D>();

function numberOf(value: string | number | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePoints(value: string | number | undefined): number[] {
  if (typeof value !== 'string') return [];
  return value
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** 把 Lucide 的节点数据转成 24×24 坐标系下的 Path2D（结果缓存，可反复描边） */
export function iconPath(node: IconNode): Path2D {
  const cached = PATH_CACHE.get(node);
  if (cached) return cached;

  const path = new Path2D();
  for (const [tag, attrs] of node) {
    switch (tag) {
      case 'path': {
        const d = attrs['d'];
        if (typeof d === 'string') path.addPath(new Path2D(d));
        break;
      }
      case 'circle': {
        path.moveTo(numberOf(attrs['cx']) + numberOf(attrs['r']), numberOf(attrs['cy']));
        path.arc(numberOf(attrs['cx']), numberOf(attrs['cy']), numberOf(attrs['r']), 0, Math.PI * 2);
        break;
      }
      case 'ellipse': {
        const cx = numberOf(attrs['cx']);
        const cy = numberOf(attrs['cy']);
        const rx = numberOf(attrs['rx']);
        const ry = numberOf(attrs['ry']);
        path.moveTo(cx + rx, cy);
        path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        break;
      }
      case 'rect': {
        const x = numberOf(attrs['x']);
        const y = numberOf(attrs['y']);
        const w = numberOf(attrs['width']);
        const h = numberOf(attrs['height']);
        const r = numberOf(attrs['rx']);
        if (r > 0) {
          path.moveTo(x + r, y);
          path.arcTo(x + w, y, x + w, y + h, r);
          path.arcTo(x + w, y + h, x, y + h, r);
          path.arcTo(x, y + h, x, y, r);
          path.arcTo(x, y, x + w, y, r);
          path.closePath();
        } else {
          path.rect(x, y, w, h);
        }
        break;
      }
      case 'line': {
        path.moveTo(numberOf(attrs['x1']), numberOf(attrs['y1']));
        path.lineTo(numberOf(attrs['x2']), numberOf(attrs['y2']));
        break;
      }
      case 'polyline':
      case 'polygon': {
        const points = parsePoints(attrs['points']);
        if (points.length >= 4) {
          path.moveTo(points[0] as number, points[1] as number);
          for (let i = 2; i + 1 < points.length; i += 2) {
            path.lineTo(points[i] as number, points[i + 1] as number);
          }
          if (tag === 'polygon') path.closePath();
        }
        break;
      }
      default:
        break;
    }
  }

  PATH_CACHE.set(node, path);
  return path;
}

/**
 * 在 Canvas 上描边一个图标。
 *
 * 调用方给的是"图标中心的屏幕坐标 + 目标视觉尺寸"，线宽按缩放反向补偿，
 * 保证大图标不会被画成粗黑块。
 */
export function strokeIcon(
  ctx: CanvasRenderingContext2D,
  node: IconNode,
  centerX: number,
  centerY: number,
  size: number,
  strokeStyle: string,
  lineWidth = 2,
): void {
  const scale = size / ICON_VIEWBOX;
  ctx.save();
  ctx.translate(centerX - size / 2, centerY - size / 2);
  ctx.scale(scale, scale);
  ctx.lineWidth = lineWidth / scale;
  ctx.strokeStyle = strokeStyle;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(iconPath(node));
  ctx.restore();
}

/* ────────────────────────────── React 组件 ────────────────────────────── */

function toReactProps(
  attrs: Record<string, string | number | undefined>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    // React 的 SVG 属性用 camelCase（stroke-width → strokeWidth）
    out[key.includes('-') ? key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) : key] = value;
  }
  return out;
}

/**
 * SVG 版图标：与 Canvas 用的是同一份数据（`deviceIcon` / `portIcon` / `uiIcon` 的返回值）。
 */
export function Icon({
  node,
  size = 16,
  className,
  strokeWidth = 2,
}: {
  node: IconNode;
  size?: number;
  className?: string;
  strokeWidth?: number;
}): ReactNode {
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: `0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className,
      'aria-hidden': true,
    },
    node.map(([tag, attrs], index) => createElement(tag, { key: index, ...toReactProps(attrs) })),
  );
}
