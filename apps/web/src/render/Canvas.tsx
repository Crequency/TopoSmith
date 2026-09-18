/**
 * 拓扑画布：指针交互、多选、吸附与流向动画
 *
 * 画布**不做任何网络语义判断**：连线时它只把两端 `{deviceId, portId}` 交给
 * store（store 内部用 `engine.negotiateLink` 预检），于是"为什么不让我连"与
 * "为什么这条链路只有 2.5G"用的是同一套判定（docs/04-architecture.md §5）。
 *
 * 交互约定（D-21）：
 *   左键拖动空白 = 框选      左键拖设备 = 移动（Shift 点选可多选）
 *   中键 / 右键 / 空格+左键 = 平移      滚轮 = 以指针为锚点缩放
 *   按住 Alt 拖动 = 临时关闭吸附
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { formatSpeed } from '@toposmith/catalog';
import { DEFAULT_LABEL_RATIO, clampLabelRatio } from '@toposmith/schema';
import { Icon, uiIcon } from '../lib/icons';
import {
  CARD_RESIZE_TOL_PX,
  GRID_SIZE,
  MIN_CARD_W,
  MAX_CARD_W,
  cardResizeEdge,
  cardWidthOf,
  NODE_H,
  NODE_W,
  SNAP_THRESHOLD,
  snapToGrid,
  boxContainsPoint,
  boxIntersects,
  computeSnap,
  normalizeBox,
  deviceFlipButtonRect,
  rackContainsPoint,
  rackFlipButtonRect,
  rackSlotAt,
  type Box,
  type Point,
  type SnapGuides,
} from '../lib/geometry';
import {
  advanceDistance,
  buildFlowPath,
  hopIndexAt,
  initialDistances,
  isStopped,
  FLOW_BASE_SPEED,
  type FlowPath,
  type FlowSegmentSource,
} from '../lib/flow';
import {
  COVERAGE_EDGE_TOL_PX,
  COVERAGE_HANDLE_PX,
  angleFromPointer,
  azimuthFromPointer,
  azimuthGrabOffset,
  coverageHitTest,
  coverageView,
  coverageViews,
  patchFromDrag,
  radiusFromPointer,
  type CoverageHandle,
} from '../lib/coverage';
import { drawSignals, signalLinks } from './signals';
import { SpeedLegend } from '../components/SpeedLegend';
import { ShortcutDialog } from '../components/ShortcutDialog';
import { deviceSide, hasRearPorts, visiblePortGlyphs } from '../lib/ports';
import { useApp, type LinkDraft } from '../state/store';
import {
  drawScene,
  hitCable,
  hitCableLabel,
  hitDevice,
  hitRect,
  linkPath,
  screenToWorld,
  type FlowView,
} from './draw';
import { nearestRatio } from '../lib/polyline';
import { createSway, isSwaySettled, stepSway, swayScaleForSpan } from '../lib/cable-physics';
import { linkAnchorMidpoint, linkSpan } from '../lib/link-path';
import type { CableSway } from '../lib/cable-physics';

const NO_GUIDES: SnapGuides = { vertical: [], horizontal: [] };

/** 设备当前观察面：上架设备跟随机柜，未上架设备用自身翻转状态 */
function activeSideOf(
  world: ReturnType<typeof useApp.getState>['world'],
  deviceId: string,
): 'front' | 'rear' {
  const device = world.devices.get(deviceId);
  if (!device) return 'front';
  const rack = device.mount ? world.devices.get(device.mount.rackId) : undefined;
  return deviceSide(device, rack?.rack?.flipped ?? false);
}

/** 只对"当前可见的端口图元"做命中测试（机柜翻转后另一面的端口点不到） */
function hitVisiblePort(
  world: ReturnType<typeof useApp.getState>['world'],
  device: { id: string; kind: string; ports: unknown[] },
  x: number,
  y: number,
): string | undefined {
  const full = world.devices.get(device.id);
  if (!full) return undefined;
  const side = activeSideOf(world, device.id);
  let best: { id: string; distance: number } | undefined;
  for (const glyph of visiblePortGlyphs(full, side)) {
    const pad = 2;
    if (
      x < glyph.x - pad ||
      x > glyph.x + glyph.w + pad ||
      y < glyph.y - pad ||
      y > glyph.y + glyph.h + pad
    ) {
      continue;
    }
    const distance = Math.hypot(x - glyph.centerX, y - glyph.centerY);
    if (!best || distance < best.distance) best = { id: glyph.port.id, distance };
  }
  return best?.id;
}

/**
 * 指针是否贴在某台设备的**宽度拖拽边缘**上（FR-49）。
 *
 * 在**屏幕空间**判定（把世界边缘 x 换成屏幕 x 再比像素距离）：
 * 热区必须是"手指能抓住的几像素"，而不是随缩放变化的世界距离 ——
 * 缩到 30% 时，5 世界单位只有 1.5 像素，根本抓不住。
 */
function deviceEdgeUnder(
  world: ReturnType<typeof useApp.getState>['world'],
  camera: { x: number; y: number; k: number },
  worldX: number,
  worldY: number,
): string | null {
  for (let i = world.ordered.length - 1; i >= 0; i -= 1) {
    const device = world.ordered[i];
    if (!device) continue;
    const edge = cardResizeEdge(device);
    if (!edge) continue;
    if (worldY < edge.top || worldY > edge.bottom) continue;
    const screenGap = Math.abs(worldX - edge.x) * camera.k;
    if (screenGap <= CARD_RESIZE_TOL_PX) return device.id;
  }
  return null;
}

/** 指针下方是否有机柜（用于拖放上架） */
function rackUnder(world: ReturnType<typeof useApp.getState>['world'], x: number, y: number) {
  for (let i = world.ordered.length - 1; i >= 0; i -= 1) {
    const device = world.ordered[i];
    if (device.kind !== 'rack' || !device.rack) continue;
    if (rackContainsPoint(device, x, y)) return device;
  }
  return undefined;
}

/** 拖动历史条目的名字 */
function idsLabel(ids: string[]): string {
  return ids.length > 1 ? `移动 ${ids.length} 台设备` : '移动设备';
}

type DragMode = 'none' | 'pan' | 'device' | 'marquee' | 'label' | 'resize' | 'coverage';

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  /**
   * 是否已经越过"点击-拖动"判定阈值。
   * 没有它的话，单击选中设备时手指/鼠标的 1–2 像素抖动也会把卡片挪走（用户实测反馈）。
   */
  armed: boolean;
  startWorld?: Point;
  anchorId?: string;
  origins?: { deviceId: string; x: number; y: number }[];
  /** 正在拖动的连线标签所属链路（FR-46） */
  labelLinkId?: string;
  /** 正在调整宽度的设备（FR-49） */
  resizeDeviceId?: string;
  /** 正在拖动的覆盖手柄所属设备（D-56） */
  coverageDeviceId?: string;
  coverageHandle?: CoverageHandle;
  /** 抓取瞬间"指针方位角 − 扇形朝向"，拖朝向时用它保持不跳 */
  coverageGrabOffsetDeg?: number;
}

/** 超过这个屏幕像素距离才算拖动（否则视为单击） */
const DRAG_THRESHOLD_PX = 4;

/** 标签拖到中点附近就吸附回中线（屏幕像素）—— 让"拖回默认位置"是可靠的，而不是靠手感 */
const LABEL_SNAP_PX = 10;

/**
 * 信号波的帧间隔（毫秒）。
 *
 * 不做 60 fps：信号点是"在流动"而不是"在高频闪"，15 fps 已经足够顺；
 * 而覆盖层每帧的重绘成本与场景规模无关（只画几条关联的几个圆点），
 * 因此这里省的是电池，不是画质。与 FR-50 的"静止时不烧 CPU"同一条思路：
 * 屏幕上没有信号波时，循环会自己停下。
 */
const SIGNAL_FRAME_MS = 66;
/** 信号点从一端流到另一端的周期（秒） */
const SIGNAL_PERIOD_S = 2.2;

/** 上一帧采样超过这么久就算"过期"：说明中间没有连续观察（FR-50） */
const SWAY_SAMPLE_STALE_MS = 100;
/**
 * 过期采样那一帧的速度折减。
 *
 * 不能直接丢掉这一帧的速度：**一次很快的甩动可能整段都落在两帧之间**，
 * 丢掉就等于"甩得越快越不动"。折减到 35% 既避免"空闲两秒后瞬移"制造巨浪，
 * 又让快甩真的甩起来（输入速度另有硬上限，见 cable-physics）。
 */
const SWAY_WAKE_VELOCITY_SCALE = 0.35;
/** 被唤醒后至少再跑几帧，让物理真正开始（FR-50） */
const SWAY_WARMUP_FRAMES = 3;

interface FlowRuntime {
  distances: number[];
  pulse: number;
  activeHop: number | null;
  stopped: boolean;
  /** 逐跳演示的停顿截止时间（performance.now() 基准） */
  dwellUntil: number;
}

export function TopologyCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const world = useApp((s) => s.world);
  const viewport = useApp((s) => s.viewport);
  const selection = useApp((s) => s.selection);
  const linkMode = useApp((s) => s.linkMode);
  const linkDraft = useApp((s) => s.linkDraft);
  const diagResult = useApp((s) => s.diag.result);
  const animation = useApp((s) => s.animation);

  const [hoverPort, setHoverPort] = useState<LinkDraft | null>(null);
  const [hoverRackId, setHoverRackId] = useState<string | null>(null);
  /** 悬浮中的"有背板端口"的设备：卡片半透明 + 露出背面端口（FR-48） */
  const [hoverDeviceId, setHoverDeviceId] = useState<string | null>(null);
  const [hoverLabelId, setHoverLabelId] = useState<string | null>(null);
  /** 指针贴在某台设备右边缘上（可拖拽调宽，FR-49） */
  const [hoverResizeId, setHoverResizeId] = useState<string | null>(null);
  /** 指针悬停/正在拖动的覆盖手柄（D-56） */
  const [hoverCoverage, setHoverCoverage] = useState<{ deviceId: string; handle: CoverageHandle } | null>(
    null,
  );
  const [resizeDeviceId, setResizeDeviceId] = useState<string | null>(null);
  const [dragLabelId, setDragLabelId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [guides, setGuides] = useState<SnapGuides>(NO_GUIDES);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  /* ── 连线摆动物理（FR-50）：每一帧推进一次弹簧模型 ── */
  const swayRef = useRef(new Map<string, CableSway>());
  const swayPrevMid = useRef(new Map<string, Point>());
  const swayFrame = useRef(0);
  const swayLast = useRef(0);
  /** 上一次采样的时刻：用来判断"上一帧的位置还算不算数"（空闲两秒后的第一帧没有有效速度） */
  const swayPrevTime = useRef(0);
  /**
   * 唤醒后至少再跑几帧。
   *
   * 为什么必须有它：从静止被唤醒的那一帧**不能**用上一帧位置算速度（那是"瞬移速度"），
   * 于是这一帧的速度必然是 0、偏移也是 0 —— 如果此时因为"都静止"就停掉循环，
   * 物理就永远不会开始，拖动时连线一根都不动。
   */
  const swayWarmup = useRef(0);

  const drag = useRef<DragState>({
    mode: 'none',
    armed: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const flowRuntime = useRef<FlowRuntime | null>(null);
  const renderRef = useRef<() => void>(() => {});

  /* ── 信号波动画（独立覆盖层，见 render/signals.ts） ── */
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const signalPhase = useRef(0);
  const signalFrame = useRef(0);
  const signalLastDraw = useRef(0);
  /** 上一次覆盖层画出来的关联条数：0 表示屏幕上没有信号波，动画循环可以停掉 */
  const signalVisible = useRef(0);
  /** 系统的"降低动效"偏好：开启时只画一张静态图，不推进相位 */
  const reducedMotion = useRef(false);

  /* ── 尺寸自适应 ── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const report = () => {
      const next = { width: container.clientWidth, height: container.clientHeight };
      setSize(next);
      useApp.getState().setCanvasSize(next);
    };
    const observer = new ResizeObserver(report);
    observer.observe(container);
    report();
    return () => observer.disconnect();
  }, []);

  /* ── 键盘：删除、Esc、空格平移、全选 ── */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const store = useApp.getState();

      /*
       * 命令菜单（FR-71）：Ctrl/Cmd+Shift+P —— 与 VSCode 同一个快捷键。
       * 刻意放在"输入框里不响应"的守卫**之前**：这是个带修饰键的组合键，
       * 与打字不冲突，而用户在任何地方想调出命令面板都应该能调出来（VSCode 亦如此）。
       */
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        store.togglePalette();
        return;
      }

      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (event.code === 'Space') {
        event.preventDefault();
        setSpaceHeld(true);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        store.deleteSelection();
      } else if (event.key === 'Escape') {
        store.cancelLink();
        store.setLinkMode(false);
        store.clearSelection();
        setMarquee(null);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        store.selectManyDevices(store.world.ordered.map((device) => device.id));
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        // Shift+Z 与 Ctrl+Y 都是重做（跨平台惯例）
        if (event.shiftKey) store.redo();
        else store.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        store.redo();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  /* ── 诊断结果 → 动画路径 ── */
  const flowPath: FlowPath | null = useMemo(() => {
    if (!diagResult) return null;
    return buildFlowPath(
      diagResult.hops,
      {
        center: (deviceId) => {
          const device = world.devices.get(deviceId);
          return device ? { x: device.x + NODE_W / 2, y: device.y + NODE_H / 2 } : undefined;
        },
        segmentsForHop: (hop) => {
          const result: FlowSegmentSource[] = [];
          let cursor = hop.deviceId;
          for (const linkId of hop.transitLinkIds ?? []) {
            const link = world.linksById.get(linkId);
            if (!link) continue;
            const cable = linkPath(world, link);
            if (!cable) continue;
            // 按数据流方向定向：linkPath 的折线是从 link.a 到 link.b
            const forward = link.a.deviceId === cursor;
            result.push({
              points: forward ? cable.points : [...cable.points].reverse(),
              speedMbps: link.speedMbps,
              family: link.family,
            });
            cursor = forward ? link.b.deviceId : link.a.deviceId;
          }
          return result;
        },
      },
      diagResult.ok,
    );
  }, [diagResult, world]);

  /* ── 每次诊断/重放都重置粒子 ── */
  useEffect(() => {
    if (!flowPath) {
      flowRuntime.current = null;
      return;
    }
    flowRuntime.current = {
      distances: initialDistances(flowPath),
      pulse: 0,
      activeHop: null,
      stopped: false,
      dwellUntil: 0,
    };
    renderRef.current();
  }, [flowPath, animation.token]);

  /* ── 动画循环：只更新 ref + 直接重绘，不触发 React 渲染 ── */
  useEffect(() => {
    if (!animation.playing || !flowPath) return;
    let frame = 0;
    let last = performance.now();
    const hopByHop = diagResult?.kind === 'trace';

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const runtime = flowRuntime.current;
      if (runtime) {
        runtime.pulse = (runtime.pulse + dt * 1.4) % 1;
        if (now >= runtime.dwellUntil) {
          const lead = runtime.distances[0] ?? 0;
          const before = hopIndexAt(flowPath, lead);
          runtime.distances = runtime.distances.map((distance) =>
            advanceDistance(flowPath, distance, dt, animation.rate),
          );
          const after = hopIndexAt(flowPath, runtime.distances[0] ?? 0);
          // 逐跳演示：粒子跨过一跳就停一下，方便用户看清"这一跳去了哪里"
          if (hopByHop && after > before) runtime.dwellUntil = now + 340;
          runtime.activeHop = after;
        }
        runtime.stopped = isStopped(flowPath, runtime.distances[0] ?? 0);
      }
      renderRef.current();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animation.playing, animation.rate, flowPath, diagResult]);

  /* ── 信号波覆盖层：独立画布 + 按需启动的低频动画循环 ── */

  /**
   * 重画覆盖层，返回屏幕上真正画出来的关联条数。
   *
   * 覆盖层是**透明**的：它只负责"会动的那几个信号点/涟漪"，主场景透过来显示。
   * 因此主场景每重画一次（相机变了、设备动了），它也必须重画一次 —— 否则
   * 信号波会停在旧位置上。
   */
  const drawOverlay = useCallback((phase: number) => {
    const canvas = overlayRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return 0;
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const pixelWidth = Math.max(1, Math.floor(width * dpr));
    const pixelHeight = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const store = useApp.getState();
    return drawSignals(ctx, {
      world: store.world,
      camera: store.viewport,
      width,
      height,
      phase,
    });
  }, []);

  const stepSignals = useCallback(
    (now: number) => {
      signalFrame.current = 0;
      if (reducedMotion.current) return;
      const elapsed = now - signalLastDraw.current;
      if (elapsed < SIGNAL_FRAME_MS) {
        signalFrame.current = requestAnimationFrame(stepSignals);
        return;
      }
      signalLastDraw.current = now;
      signalPhase.current = (signalPhase.current + elapsed / 1000 / SIGNAL_PERIOD_S) % 1;
      signalVisible.current = drawOverlay(signalPhase.current);
      // 屏幕上没有信号波就停下；下一次主场景重画（平移/缩放/改世界）会把它唤醒
      if (signalVisible.current > 0) signalFrame.current = requestAnimationFrame(stepSignals);
    },
    [drawOverlay],
  );

  /** 启动信号波动画（幂等）。屏幕上没有可动的关联时不会启动 */
  const kickSignals = useCallback(() => {
    if (signalFrame.current !== 0 || reducedMotion.current) return;
    if (signalLinks(useApp.getState().world).length === 0) return;
    signalLastDraw.current = performance.now();
    signalFrame.current = requestAnimationFrame(stepSignals);
  }, [stepSignals]);

  useEffect(
    () => () => {
      if (signalFrame.current !== 0) cancelAnimationFrame(signalFrame.current);
      signalFrame.current = 0;
    },
    [],
  );

  // 系统偏好变化时立刻生效：开启降低动效 → 停掉循环（主场景那一帧仍是静态信号波）
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.current = media.matches;
    const onChange = () => {
      reducedMotion.current = media.matches;
      if (media.matches && signalFrame.current !== 0) {
        cancelAnimationFrame(signalFrame.current);
        signalFrame.current = 0;
      } else if (!media.matches) {
        kickSignals();
      }
      renderRef.current();
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [kickSignals]);

  /**
   * 连线摆动的一个物理步（FR-50）。
   *
   * 速度来自"连线锚点中点这一帧相对上一帧的位移"——注意用的是**不带摆动**的
   * 刚性路径，否则摆动自己会变成速度来源，越摆越大。
   */
  const stepSwayPhysics = useCallback(
    (now: number) => {
      swayFrame.current = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - swayLast.current) / 1000));
      swayLast.current = now;

      const current = useApp.getState().world;
      const mids = new Map<string, Point>();
      let active = false;
      let moving = false;
      // 上一帧采样是否"新鲜"：空闲很久之后的第一帧不产生速度（避免瞬移式巨浪）
      const fresh = now - swayPrevTime.current <= SWAY_SAMPLE_STALE_MS;

      for (const link of current.links) {
        const mid = linkAnchorMidpoint(current, link);
        if (!mid) continue;
        mids.set(link.id, mid);
        const sway = swayRef.current.get(link.id) ?? createSway();
        swayRef.current.set(link.id, sway);

        const prev = swayPrevMid.current.get(link.id);
        if (prev) {
          const wakeScale = fresh ? 1 : SWAY_WAKE_VELOCITY_SCALE;
          const vx = ((mid.x - prev.x) / dt) * wakeScale;
          const vy = ((mid.y - prev.y) / dt) * wakeScale;
          if (Math.hypot(vx, vy) > 0.5) moving = true;
          stepSway(sway, { x: vx, y: vy }, dt, swayScaleForSpan(linkSpan(current, link)));
        }
        if (!isSwaySettled(sway)) active = true;
      }

      // 连线被删掉后，状态也要跟着清掉（否则 Map 会一直留着旧 id）
      for (const id of [...swayRef.current.keys()]) {
        if (!mids.has(id)) {
          swayRef.current.delete(id);
          swayPrevMid.current.delete(id);
        }
      }
      swayPrevMid.current = mids;
      swayPrevTime.current = now;
      if (swayWarmup.current > 0) swayWarmup.current -= 1;

      renderRef.current();
      // 只要还在动（或被刚唤醒）就继续跑；否则停掉，静止时不烧 CPU
      if (active || moving || swayWarmup.current > 0) {
        swayFrame.current = requestAnimationFrame(stepSwayPhysics);
      }
    },
    [],
  );

  /**
   * 启动摆动循环（幂等）。
   *
   * 不做常驻 rAF：静止时没有任何物理要算，常驻循环等于白白耗电。
   * "世界变了"就是唯一的触发条件 —— 拖动设备、对齐、撤销、上架都会走到这里。
   */
  const kickSway = useCallback(() => {
    if (swayFrame.current !== 0) return;
    swayWarmup.current = SWAY_WARMUP_FRAMES;
    swayLast.current = performance.now();
    swayFrame.current = requestAnimationFrame(stepSwayPhysics);
  }, [stepSwayPhysics]);

  useEffect(
    () => () => {
      if (swayFrame.current !== 0) cancelAnimationFrame(swayFrame.current);
      swayFrame.current = 0;
    },
    [],
  );

  // 开发环境暴露摆动状态与相机，供端到端脚本断言"连线真的在摇"（生产构建会摇掉）
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const api = (window as unknown as Record<string, unknown>)['__toposmith'] as
      | Record<string, unknown>
      | undefined;
    if (!api) return;
    api['swaySnapshot'] = () =>
      [...swayRef.current.entries()].map(([id, sway]) => ({ id, ...sway }));
    api['camera'] = () => ({ ...useApp.getState().viewport });
    return () => {
      delete api['swaySnapshot'];
    };
  }, []);

  /* ── 每次渲染后重建绘制闭包并立即重绘 ── */
  useEffect(() => {
    renderRef.current = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.floor(size.width * dpr));
      const pixelHeight = Math.max(1, Math.floor(size.height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 诊断结果 → 画布高亮
      const pathDeviceIds: string[] = [];
      const pathLinkIds: string[] = [];
      const pathStepByDevice = new Map<string, number>();
      if (
        diagResult &&
        (diagResult.kind === 'ping' ||
          diagResult.kind === 'trace' ||
          diagResult.kind === 'bandwidth')
      ) {
        diagResult.hops.forEach((hop, index) => {
          pathDeviceIds.push(hop.deviceId);
          pathStepByDevice.set(hop.deviceId, index + 1);
          if (!hop.outPortId) return;
          for (const link of world.linksByPort.get(`${hop.deviceId}:${hop.outPortId}`) ?? []) {
            pathLinkIds.push(link.id);
          }
        });
      }

      const runtime = flowRuntime.current;
      const flow: FlowView | null =
        flowPath && runtime
          ? {
              path: flowPath,
              distances: runtime.distances,
              activeHop: runtime.activeHop,
              stopped: runtime.stopped,
              pulse: runtime.pulse,
            }
          : null;

      drawScene(ctx, {
        world,
        camera: viewport,
        cableSway: swayRef.current,
        resizeHandleId: resizeDeviceId ?? hoverResizeId,
        coverageActive:
          drag.current.mode === 'coverage' && drag.current.coverageDeviceId && drag.current.coverageHandle
            ? { deviceId: drag.current.coverageDeviceId, handle: drag.current.coverageHandle }
            : hoverCoverage,
        coverageSelectedIds: selection.devices,
        width: size.width,
        height: size.height,
        selection,
        linkMode,
        linkDraft,
        hoverPort,
        hoverRackId,
        hoverDeviceId,
        activeLabelId: dragLabelId ?? hoverLabelId,
        cursor,
        marquee,
        guides,
        pathDeviceIds,
        pathLinkIds,
        pathStepByDevice,
        flow,
      });

      // 信号波画在独立覆盖层上（见 render/signals.ts）：主场景一重画就得跟着重画
      signalVisible.current = drawOverlay(reducedMotion.current ? 0 : signalPhase.current);
    };
    renderRef.current();
    // 屏幕上有信号波才启动低频动画循环；没有就让它保持停止（不烧 CPU）
    if (signalVisible.current > 0) kickSignals();
  });

  /*
   * 世界一变就唤醒摆动循环（拖动设备、对齐、撤销、上架、改宽度都会改 world）。
   * 放在这里而不是 pointermove 里：不管位移是怎么产生的，连线都该甩一下。
   */
  useEffect(() => {
    kickSway();
  }, [world, viewport, kickSway]);

  /* ── 指针坐标 ── */
  const pointerPos = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const store = useApp.getState();
    const pos = pointerPos(event);
    const point = screenToWorld(viewport, pos.x, pos.y);

    // 中键 / 右键 / 空格 → 平移（左键留给"选择与移动"，避免误触）
    if (event.button === 1 || event.button === 2 || spaceHeld) {
      drag.current = {
        mode: 'pan',
        armed: true,
        startX: pos.x,
        startY: pos.y,
        originX: viewport.x,
        originY: viewport.y,
      };
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    const hit = hitDevice(world, point.x, point.y);
    // Ctrl / Cmd / Shift 都是"追加选择"（用户要求 Ctrl+点击 多选）
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;

    // 连线标签画在**所有东西之上**，所以命中也排在最前：
    // 按住标签拖动 = 调整标签在连线上的位置（FR-46），而不是选中下面的设备。
    if (!linkMode) {
      // 与绘制端共用 LOD 判据：看不见的标签不该被点到（否则低缩放下会误拖标签）
      const emphasized = [
        ...selection.cables,
        ...(diagResult?.hops ?? []).flatMap((hop) => hop.transitLinkIds ?? []),
      ];
      const label = hitCableLabel(world, viewport, point.x, point.y, swayRef.current, emphasized);
      if (label) {
        if (!selection.cables.includes(label.id)) store.selectOneCable(label.id);
        setDragLabelId(label.id);
        drag.current = {
          mode: 'label',
          armed: false,
          startX: pos.x,
          startY: pos.y,
          originX: 0,
          originY: 0,
          labelLinkId: label.id,
        };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }

    /*
     * 覆盖手柄与圈边（D-56）：排在连线标签之后、卡片边缘之前。
     *
     * 两条优先级规则，都是为了"看到什么就操作什么"：
     *   · **显式手柄**（画出来的小方块/圆点）永远可抓 —— 即使它压在某张卡片上；
     *   · **隐形圈边**只在指针下方没有设备卡片时参与判定 —— 卡片压在圈边上时，
     *     用户想拖的是卡片，而不是把覆盖范围改小。
     */
    if (!linkMode) {
      const views = coverageViews(world.ordered);
      if (views.length > 0) {
        const coverageHit = coverageHitTest(views, point, COVERAGE_EDGE_TOL_PX / viewport.k, {
          edgeAllowed: hit === undefined,
          handleWorld: (COVERAGE_HANDLE_PX * 1.6) / viewport.k,
        });
        if (coverageHit) {
          const provider = world.devices.get(coverageHit.view.deviceId);
          if (provider) {
            if (!selection.devices.includes(provider.id)) store.selectOneDevice(provider.id);
            store.beginHistory('调整无线覆盖');
            drag.current = {
              mode: 'coverage',
              // 抓圈边时可能是"点一下选中"，所以仍然走阈值判定
              armed: false,
              startX: pos.x,
              startY: pos.y,
              originX: 0,
              originY: 0,
              coverageDeviceId: provider.id,
              coverageHandle: coverageHit.handle,
              coverageGrabOffsetDeg: azimuthGrabOffset(coverageHit.view, point),
            };
            setHoverCoverage({ deviceId: provider.id, handle: coverageHit.handle });
            canvas.setPointerCapture(event.pointerId);
            return;
          }
        }
      }
    }

    /*
     * 宽度拖拽边缘（FR-49）：优先于卡片本体（否则一按就变成"移动设备"）。
     *
     * 用**与悬浮提示同一个判定函数**（`deviceEdgeUnder`），而不是"先 hitDevice 再算它的边缘"：
     * 两张卡片叠在一起时，`hitDevice` 命中的可能是压在上面的那张，而边缘属于下面那张 ——
     * 于是光标显示"可拖宽度"、按下去却在拖另一台设备。**看到什么就该操作什么。**
     */
    if (!linkMode) {
      const edgeDeviceId = deviceEdgeUnder(world, viewport, point.x, point.y);
      if (edgeDeviceId) {
        if (!selection.devices.includes(edgeDeviceId)) store.selectOneDevice(edgeDeviceId);
        store.beginHistory('调整卡片宽度');
        setResizeDeviceId(edgeDeviceId);
        drag.current = {
          mode: 'resize',
          // 拖边缘本身就是"拖动"，没有"点一下"的语义，直接进入拖动状态
          armed: true,
          startX: pos.x,
          startY: pos.y,
          originX: 0,
          originY: 0,
          resizeDeviceId: edgeDeviceId,
        };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }

    // 翻转按钮优先被命中：机柜标题栏的按钮，以及设备卡片右上角的按钮
    if (!linkMode && hit?.kind === 'rack' && hit.rack) {
      const button = rackFlipButtonRect(hit);
      if (boxContainsPoint(button, point)) {
        store.flipRack(hit.id);
        return;
      }
    }
    if (!linkMode && hit && !hit.mount && hasRearPorts(hit)) {
      const button = deviceFlipButtonRect({ x: hit.x, y: hit.y, w: cardWidthOf(hit) });
      if (boxContainsPoint(button, point)) {
        store.flipDevice(hit.id);
        return;
      }
    }

    if (linkMode) {
      if (hit) {
        const portId = hitVisiblePort(world, hit, point.x, point.y);
        if (portId) {
          store.clickPort(hit.id, portId);
          return;
        }
      }
      return; // 连线模式下点空白处不做任何事，避免误操作
    }

    // 端口图元优先于卡片本体：点击端口是"编辑这个端口"，而不是"拖动设备"
    if (hit) {
      const portId = hitVisiblePort(world, hit, point.x, point.y);
      if (portId) {
        if (additive && selection.devices.length > 0) {
          // 已经多选设备时，加选端口没有意义，直接切换端口选择
          store.selectPort(hit.id, portId);
          return;
        }
        store.selectPort(hit.id, portId);
        return;
      }
    }

    const device = hit;
    if (device) {
      if (additive) {
        store.toggleDevice(device.id);
        return;
      }
      if (!selection.devices.includes(device.id)) store.selectOneDevice(device.id);
      drag.current = {
        mode: 'device',
        // 尚未越过阈值就不算拖动，也不记历史
        armed: false,
        startX: pos.x,
        startY: pos.y,
        originX: 0,
        originY: 0,
        anchorId: device.id,
        origins: world.ordered
          .filter((item) =>
            (selection.devices.includes(device.id) ? selection.devices : [device.id]).includes(
              item.id,
            ),
          )
          .map((item) => ({ deviceId: item.id, x: item.x, y: item.y })),
      };
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    const cable = hitCable(world, point.x, point.y);
    if (cable) {
      if (event.shiftKey) store.toggleCable(cable.id);
      else store.selectOneCable(cable.id);
      return;
    }

    if (!additive) store.clearSelection();
    drag.current = {
      mode: 'marquee',
      armed: false,
      startX: pos.x,
      startY: pos.y,
      originX: 0,
      originY: 0,
      startWorld: point,
    };
    setMarquee({ x: point.x, y: point.y, w: 0, h: 0 });
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pos = pointerPos(event);
    setCursor(pos);
    const point = screenToWorld(viewport, pos.x, pos.y);
    const current = drag.current;

    const hoverTarget = hitDevice(world, point.x, point.y);
    const hoverGlyphId = hoverTarget
      ? hitVisiblePort(world, hoverTarget, point.x, point.y)
      : undefined;
    if (hoverTarget && hoverGlyphId) {
      setHoverPort({ deviceId: hoverTarget.id, portId: hoverGlyphId });
    } else if (hoverPort) {
      setHoverPort(null);
    }
    // 悬浮机柜 → 半透明；移开则恢复
    const rackHovered = rackUnder(world, point.x, point.y);
    setHoverRackId(rackHovered?.id ?? null);

    /*
     * 悬浮"有背板端口的设备" → 卡片半透明 + 露出背面的端口图元（FR-48）。
     *
     * 只在没有拖动进行时才淡出：拖动中把卡片变半透明会让人看不清自己在把设备拖到哪里；
     * 机柜本身不参与（它有自己那条路径），否则会与 hoverRackId 重复淡出。
     */
    const hoverDevice =
      current.mode === 'none' && hoverTarget && hoverTarget.kind !== 'rack' && hasRearPorts(hoverTarget)
        ? hoverTarget.id
        : null;
    setHoverDeviceId(hoverDevice);

    // 悬浮设备右边缘 → 显示拖拽把手 + col-resize 光标（FR-49）
    const edgeUnder =
      current.mode === 'none' ? deviceEdgeUnder(world, viewport, point.x, point.y) : null;
    setHoverResizeId(edgeUnder);

    // 悬浮覆盖手柄/圈边 → 高亮 + 对应光标（D-56）
    const coverageUnder =
      current.mode === 'none' && !linkMode
        ? coverageHitTest(coverageViews(world.ordered), point, COVERAGE_EDGE_TOL_PX / viewport.k, {
            edgeAllowed: hoverTarget === undefined,
            handleWorld: (COVERAGE_HANDLE_PX * 1.6) / viewport.k,
          })
        : null;
    setHoverCoverage(
      coverageUnder ? { deviceId: coverageUnder.view.deviceId, handle: coverageUnder.handle } : null,
    );

    // 悬浮连线标签 → 高亮 + 手型光标（否则用户不知道标签可以拖，FR-46）
    const labelHovered =
      current.mode === 'label'
        ? undefined
        : hitCableLabel(world, viewport, point.x, point.y, swayRef.current, [
            ...selection.cables,
            ...(diagResult?.hops ?? []).flatMap((hop) => hop.transitLinkIds ?? []),
          ]);
    setHoverLabelId(labelHovered?.id ?? null);

    if (current.mode === 'pan') {
      useApp.getState().setViewport({
        x: current.originX + (pos.x - current.startX),
        y: current.originY + (pos.y - current.startY),
        k: viewport.k,
      });
      return;
    }

    if (current.mode === 'device' && current.origins && current.anchorId) {
      // 未越过阈值前不动任何东西：修复"单击选中也会拖动卡片"
      if (!current.armed) {
        const travelled = Math.hypot(pos.x - current.startX, pos.y - current.startY);
        if (travelled < DRAG_THRESHOLD_PX) return;
        current.armed = true;
        useApp.getState().beginHistory(idsLabel(current.origins.map((item) => item.deviceId)));
      }
      const dx = (pos.x - current.startX) / viewport.k;
      const dy = (pos.y - current.startY) / viewport.k;
      const anchor = current.origins.find((item) => item.deviceId === current.anchorId);
      if (!anchor) return;

      let snapDx = 0;
      let snapDy = 0;
      const snapEnabled = useApp.getState().snapEnabled;
      if (snapEnabled && !event.altKey) {
        // 按当前缩放把"屏幕阈值"换算成世界坐标，缩放后手感一致
        const selectedIds = new Set(current.origins.map((item) => item.deviceId));
        const others = world.ordered
          .filter((item) => !selectedIds.has(item.id))
          .map(hitRect);
        const anchorDevice = world.devices.get(current.anchorId);
        const anchorRect = anchorDevice ? hitRect(anchorDevice) : { w: NODE_W, h: NODE_H };
        const snap = computeSnap(
          { x: anchor.x + dx, y: anchor.y + dy, w: anchorRect.w, h: anchorRect.h },
          others,
          SNAP_THRESHOLD / viewport.k,
          GRID_SIZE,
        );
        snapDx = snap.dx;
        snapDy = snap.dy;
        setGuides(snap.guides);
      } else {
        setGuides(NO_GUIDES);
      }

      useApp.getState().moveDevices(
        current.origins.map((origin) => ({
          deviceId: origin.deviceId,
          x: origin.x + dx + snapDx,
          y: origin.y + dy + snapDy,
        })),
      );
      return;
    }

    if (current.mode === 'marquee' && current.startWorld) {
      setMarquee(normalizeBox(current.startWorld, point));
    }

    /*
     * 拖覆盖手柄（D-56）：半径 / 开合角 / 朝向，三种都走同一个"视图 → 新值 → 写回"路径。
     * 每帧的写入都在 beginHistory 打开的事务里，整段拖动只算一条历史。
     */
    if (current.mode === 'coverage' && current.coverageDeviceId && current.coverageHandle) {
      if (!current.armed) {
        const travelled = Math.hypot(pos.x - current.startX, pos.y - current.startY);
        if (travelled < DRAG_THRESHOLD_PX) return;
        current.armed = true;
      }
      const device = world.devices.get(current.coverageDeviceId);
      const view = device ? coverageView(device) : null;
      if (!device || !view) return;
      const patch =
        current.coverageHandle === 'radius'
          ? { radiusM: radiusFromPointer(view, point) }
          : current.coverageHandle === 'angle'
            ? { angleDeg: angleFromPointer(view, point) }
            : { azimuthDeg: azimuthFromPointer(view, point, current.coverageGrabOffsetDeg ?? 0) };
      const next = patchFromDrag(view, patch);
      useApp.getState().patchDevice(device.id, (d) => {
        d.wireless = { ...(d.wireless ?? { mode: 'ap' as const }), coverage: next };
      });
      return;
    }

    // 拖右边缘调宽（FR-49）：宽度按世界坐标算，吸附开启时对齐到网格
    if (current.mode === 'resize' && current.resizeDeviceId) {
      const snapEnabled = useApp.getState().snapEnabled && !event.altKey;
      const raw = point.x - (world.devices.get(current.resizeDeviceId)?.x ?? point.x);
      const width = snapEnabled
        ? snapToGrid(raw, GRID_SIZE)
        : Math.round(raw);
      useApp
        .getState()
        .setDeviceWidth(
          current.resizeDeviceId,
          Math.min(MAX_CARD_W, Math.max(MIN_CARD_W, width)),
        );
    }

    // 沿连线拖动标签：把光标投影到连线上取弧长比例（FR-46）
    if (current.mode === 'label' && current.labelLinkId) {
      if (!current.armed) {
        const travelled = Math.hypot(pos.x - current.startX, pos.y - current.startY);
        if (travelled < DRAG_THRESHOLD_PX) return;
        current.armed = true;
        // 整段拖动算一条历史，而不是每一帧一条
        useApp.getState().beginHistory('调整标签位置');
      }
      const link = world.links.find((item) => item.id === current.labelLinkId);
      const path = link ? linkPath(world, link) : null;
      if (!link || !path) return;

      const projection = nearestRatio(path.points, point);
      // 靠近中点就吸附回中线：让"拖回默认位置"是可复现的，而不是靠手感
      const distanceToMid = Math.hypot(point.x - path.mid.x, point.y - path.mid.y) * viewport.k;
      const ratio =
        distanceToMid <= LABEL_SNAP_PX ? DEFAULT_LABEL_RATIO : clampLabelRatio(projection.ratio);
      useApp.getState().patchCable(link.id, { labelRatio: ratio });
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    if (current.mode === 'marquee' && marquee) {
      const store = useApp.getState();
      const hitIds = world.ordered
        .filter((device) => boxIntersects(marquee, hitRect(device)))
        .map((device) => device.id);
      if (hitIds.length > 0) store.selectManyDevices(hitIds);
      setMarquee(null);
    }
    if (current.mode === 'device') {
      setGuides(NO_GUIDES);
      const store = useApp.getState();
      if (current.armed && current.anchorId) {
        store.commitHistory();
        // 拖放上架：把机架式设备放到机柜上（柜内拖动则重新排 U 位）
        const anchor = store.world.devices.get(current.anchorId);
        const pointer = cursor ? screenToWorld(viewport, cursor.x, cursor.y) : null;
        const rack = pointer ? rackUnder(store.world, pointer.x, pointer.y) : undefined;
        if (anchor && anchor.kind !== 'rack' && rack?.rack && pointer) {
          store.mountDevice(anchor.id, rack.id, rackSlotAt(rack, pointer.y));
        }
      } else {
        // 只是单击：没有产生任何改动，丢弃事务
        store.commitHistory();
      }
    }
    if (current.mode === 'resize') {
      setResizeDeviceId(null);
      useApp.getState().commitHistory();
    }
    if (current.mode === 'coverage') {
      setHoverCoverage(null);
      // 只是点了一下圈边（选中这台设备）而没有拖动 → commit 会自动丢弃这次事务
      useApp.getState().commitHistory();
    }
    if (current.mode === 'label') {
      setDragLabelId(null);
      // 只是点了一下标签（选中它）而没有拖动 → 直接丢弃事务
      useApp.getState().commitHistory();
    }
    current.mode = 'none';
    canvasRef.current?.releasePointerCapture(event.pointerId);
  };

  /**
   * 双击标签 = 复位到中点。
   *
   * 拖拽是"自由定位"，双击是"回到默认"：没有后者的话，用户把标签拖歪之后
   * 只能靠手感重新对齐中点（FR-46）。
   */
  const onDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (linkMode) return;
    const pos = pointerPos(event);
    const point = screenToWorld(viewport, pos.x, pos.y);
    const label = hitCableLabel(world, viewport, point.x, point.y, swayRef.current, [
      ...selection.cables,
      ...(diagResult?.hops ?? []).flatMap((hop) => hop.transitLinkIds ?? []),
    ]);
    if (!label) return;
    if (label.cable.labelRatio === undefined) return;
    useApp.getState().patchCable(label.id, { labelRatio: DEFAULT_LABEL_RATIO });
    useApp.getState().showToast('标签位置已复位到连线中点', 'info');
  };

  /**
   * 滚轮缩放：**必须用非 passive 的原生监听器**。
   *
   * React 的 `onWheel` 以 passive 方式注册，在里面 `preventDefault()` 不生效，
   * 浏览器还会在控制台报 "Unable to preventDefault inside passive event listener"——
   * 结果是滚轮同时触发页面滚动与画布缩放。
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      useApp
        .getState()
        .zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top);
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);

  /**
   * 指针离开画布：清掉**所有**悬浮态。
   *
   * 没有这一步，"悬浮半透明"就会在指针移出画布后一直挂着 —— 看起来像设备坏掉了；
   * 端口高亮、机柜透视同理。拖动进行中不清（指针已被捕获，可能暂时在画布外）。
   */
  const onPointerLeave = () => {
    if (drag.current.mode !== 'none') return;
    setHoverPort(null);
    setHoverRackId(null);
    setHoverDeviceId(null);
    setHoverLabelId(null);
    setHoverResizeId(null);
    setCursor(null);
  };

  const onDrop = (event: ReactDragEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const templateKey = event.dataTransfer.getData('application/x-toposmith-template');
    if (!templateKey) return;
    const pos = pointerPos(event);
    const point = screenToWorld(viewport, pos.x, pos.y);
    useApp.getState().addDevice(templateKey, point.x - NODE_W / 2, point.y - NODE_H / 2);
  };

  const deviceCount = selection.devices.length;
  const cableCount = selection.cables.length;
  const portSelection = selection.port
    ? world.devices.get(selection.port.deviceId)?.ports.find(
        (port) => port.id === selection.port?.portId,
      )
    : undefined;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        className={`block h-full w-full ${
          linkMode
            ? 'cursor-crosshair'
            : drag.current.mode === 'coverage' || hoverCoverage
              ? hoverCoverage?.handle === 'rotate' || drag.current.coverageHandle === 'rotate'
                ? drag.current.mode === 'coverage'
                  ? 'cursor-grabbing'
                  : 'cursor-grab'
                : hoverCoverage?.handle === 'angle' || drag.current.coverageHandle === 'angle'
                  ? 'cursor-nwse-resize'
                  : 'cursor-ew-resize'
              : drag.current.mode === 'resize' || hoverResizeId
                ? 'cursor-col-resize'
                : drag.current.mode === 'label' || hoverLabelId
                  ? drag.current.mode === 'label'
                    ? 'cursor-grabbing'
                    : 'cursor-grab'
                  : drag.current.mode === 'pan' || spaceHeld
                    ? 'cursor-grabbing'
                    : 'cursor-default'
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      />

      {/*
        信号波覆盖层（D-57）：独立画布，只画会动的无线信号。
        `pointer-events-none` 是必须的 —— 它盖在整个画布上，一旦吃指针事件，
        所有命中测试（设备、端口、标签、覆盖手柄）就全都收不到事件了。
      */}
      <canvas
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 block h-full w-full"
      />

      {/* 左上角：模式提示 */}
      {linkMode && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {linkDraft
            ? '已选择起点端口，请点击目标设备的端口完成连线（Esc 取消）'
            : '连线模式：点击设备底部的小方块选择端口（Esc 退出）'}
        </div>
      )}

      {/* 右上角：规模与选择状态 */}
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-1 text-[11px]">
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-slate-400">
          {world.ordered.length} 台设备 · {world.links.length} 条链路 · 缩放{' '}
          {Math.round(viewport.k * 100)}%
        </div>
        <div className="pointer-events-auto rounded-lg border border-slate-800 bg-slate-900/85 px-3 py-2">
          <SpeedLegend compact />
        </div>
        {(deviceCount > 0 || cableCount > 0 || portSelection) && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-200">
            {portSelection
              ? `端口 ${portSelection.name}`
              : `已选 ${deviceCount > 0 ? `${deviceCount} 台设备` : ''}${
                  deviceCount > 0 && cableCount > 0 ? ' · ' : ''
                }${cableCount > 0 ? `${cableCount} 条线缆` : ''}`}
          </div>
        )}
      </div>

      {/*
        右下角：按键教学入口（FR-59）。
        原来这里是一条常驻的长说明 —— 又挤又挡画布；现在收进弹窗，
        弹窗里按键用键帽图标表示，比"Ctrl+Shift+Z"这种写法好认。
      */}
      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          title="按键与鼠标操作（点击查看）"
          aria-label="按键与鼠标操作"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-400 shadow-lg transition hover:border-sky-500 hover:text-sky-300"
        >
          <Icon node={uiIcon('help')} size={16} />
        </button>
      </div>

      {shortcutsOpen && <ShortcutDialog onClose={() => setShortcutsOpen(false)} />}

      {/* 流向动画控制条 */}
      {flowPath && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1.5 shadow-lg">
          <button
            type="button"
            onClick={useApp.getState().toggleFlow}
            className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-sky-600 hover:text-sky-300"
          >
            <Icon node={uiIcon(animation.playing ? 'pause' : 'play')} size={12} />
            {animation.playing ? '暂停' : '播放'}
          </button>
          <button
            type="button"
            onClick={useApp.getState().replayFlow}
            className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-sky-600 hover:text-sky-300"
          >
            <Icon node={uiIcon('replay')} size={12} />
            重放
          </button>
          <select
            value={String(animation.rate)}
            onChange={(event) => useApp.getState().setFlowRate(Number(event.target.value))}
            className="rounded border border-slate-700 bg-slate-950 px-1 py-1 text-[11px] text-slate-200"
            title="播放倍率"
          >
            {[0.5, 1, 2, 4].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
          <span className="text-[10px] text-slate-500">
            {flowPath.kind === 'failed'
              ? '数据在阻断点停止'
              : `最慢一跳 ${formatSpeed(flowPath.minSpeedMbps)}`}
          </span>
        </div>
      )}
    </div>
  );
}

export { FLOW_BASE_SPEED };
