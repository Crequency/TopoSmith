/**
 * 覆盖区域的交互几何（纯函数）
 *
 * 与绘制分开：绘制负责"画得像"，这里负责"抓得住" —— 手柄位置、边缘容差、
 * 拖动时算出的新半径/新角度。两者共用同一份 `coverageGeometry`（schema），
 * 因此不会出现"看到的手柄和拖到的位置差一点"这种手感 bug。
 *
 * 判定全部在**世界坐标**里做，容差由调用方按当前缩放换算成世界单位传入
 * （`COVERAGE_EDGE_TOL_PX / camera.k`）—— 热区必须是"手指能抓住的几像素"，
 * 而不是随缩放变化的世界距离（与 FR-49 的卡片边缘同一套约定）。
 */

import {
  angleDeltaDeg,
  bearingDeg,
  clampCoverageRadius,
  clampSectorAngle,
  coverageEnabled,
  coverageGeometry,
  deviceCenter,
  normalizeAzimuth,
  type CoverageShape,
  type Device,
  type Point,
  type RadioCoverage,
  worldToMeters,
} from '@toposmith/schema';

/** 一个可交互的覆盖区域（已经过"是不是提供方 / 有没有启用"的过滤） */
export interface CoverageView {
  deviceId: string;
  deviceName: string;
  coverage: RadioCoverage;
  center: Point;
  radiusWorld: number;
  shape: CoverageShape;
  angleDeg: number;
  azimuthDeg: number;
}

/** 手柄/边缘的角色：拖半径、拖开合角、拖朝向 */
export type CoverageHandle = 'radius' | 'angle' | 'rotate';

export interface CoverageHit {
  view: CoverageView;
  handle: CoverageHandle;
  /** 命中点与目标的距离（世界单位），用于在多个候选里挑最近的一个 */
  distance: number;
}

/** 手柄的屏幕半边长（像素）：方块的视觉尺寸与热区尺寸共用 */
export const COVERAGE_HANDLE_PX = 4;
/** 边缘热区在屏幕上的半宽（像素） */
export const COVERAGE_EDGE_TOL_PX = 6;

export function isCoverageProvider(device: Device): boolean {
  return device.wireless?.mode === 'ap' && coverageEnabled(device.wireless.coverage);
}

export function coverageView(device: Device): CoverageView | null {
  if (!isCoverageProvider(device)) return null;
  const coverage = device.wireless?.coverage;
  if (!coverage) return null;
  const geometry = coverageGeometry(coverage);
  return {
    deviceId: device.id,
    deviceName: device.name,
    coverage,
    center: deviceCenter(device),
    radiusWorld: geometry.radiusWorld,
    shape: geometry.shape,
    angleDeg: geometry.angleDeg,
    azimuthDeg: geometry.azimuthDeg,
  };
}

export function coverageViews(devices: Iterable<Device>): CoverageView[] {
  const out: CoverageView[] = [];
  for (const device of devices) {
    const view = coverageView(device);
    if (view) out.push(view);
  }
  return out;
}

/**
 * 手柄位置（世界坐标）。
 *
 *  - `radius`：扇形在角平分线上、全向在 0°（正右方）—— 拖它就是"把圈放大/缩小"
 *  - `angle` ：扇形的两条弧边端点（两侧各一个，画图时都用同一个角色）
 *  - `rotate`：角平分线上 0.5 半径处 —— 拖它转朝向，与半径手柄在同一根"杆"上，
 *              但分处两端，不会互相抢
 */
export function coverageHandlePoint(
  view: CoverageView,
  handle: CoverageHandle,
  side: 1 | -1 = 1,
): Point {
  const directionDeg =
    view.shape === 'omni'
      ? 0
      : handle === 'angle'
        ? view.azimuthDeg + (side * view.angleDeg) / 2
        : view.azimuthDeg;
  const distance = handle === 'rotate' ? view.radiusWorld * 0.5 : view.radiusWorld;
  const rad = (directionDeg * Math.PI) / 180;
  return {
    x: view.center.x + Math.cos(rad) * distance,
    y: view.center.y + Math.sin(rad) * distance,
  };
}

/** 点到圆环（弧）的距离：`|dist - r|`，另需方位角落在扇形内才算是"弧边" */
function arcDistance(view: CoverageView, point: Point): number | null {
  const dist = Math.hypot(point.x - view.center.x, point.y - view.center.y);
  if (view.shape === 'sector') {
    const delta = angleDeltaDeg(bearingDeg(view.center, point), view.azimuthDeg);
    // 弧边只占扇形那一段：超出开合角的部分不算（那里没有线，不该能抓）
    if (delta > view.angleDeg / 2) return null;
  }
  return Math.abs(dist - view.radiusWorld);
}

/**
 * 点到扇形某条半径边（射线）的距离；`side` 决定是哪一条。
 *
 * 容差给的是**世界距离**（由屏幕像素换算而来），这里要把它换算成角度：
 * 离圆心越远，同样的几像素对应的角度越小。返回弧长，好与"弧边距离"直接比大小。
 */
function radialDistance(
  view: CoverageView,
  point: Point,
  side: 1 | -1,
  toleranceWorld: number,
): number | null {
  if (view.shape !== 'sector') return null;
  const dist = Math.hypot(point.x - view.center.x, point.y - view.center.y);
  if (dist > view.radiusWorld) return null;
  const delta = angleDeltaDeg(
    bearingDeg(view.center, point),
    view.azimuthDeg + (side * view.angleDeg) / 2,
  );
  const toleranceDeg = (toleranceWorld / Math.max(dist, 1)) * (180 / Math.PI);
  if (delta > toleranceDeg) return null;
  return ((delta * Math.PI) / 180) * dist;
}

/**
 * 命中判定。
 *
 * 优先级：**显式手柄 > 边缘**。手柄是画出来的小方块，用户看得见就点得到；
 * 边缘是"隐形"的热区，只有指针下面没有别的东西（设备卡片）时才参与判定 ——
 * 这一条由调用方通过 `edgeAllowed` 控制，因为"卡片压在圈边上"时该拖的是卡片。
 */
export function coverageHitTest(
  views: CoverageView[],
  point: Point,
  toleranceWorld: number,
  options: { edgeAllowed?: boolean; handleWorld?: number } = {},
): CoverageHit | null {
  const edgeAllowed = options.edgeAllowed ?? true;
  const handleTolerance = options.handleWorld ?? toleranceWorld;
  let best: CoverageHit | null = null;
  const consider = (view: CoverageView, handle: CoverageHandle, distance: number, limit: number) => {
    if (distance > limit) return;
    if (best && best.distance <= distance) return;
    best = { view, handle, distance };
  };

  // 1) 显式手柄
  for (const view of views) {
    const handles: [CoverageHandle, 1 | -1][] =
      view.shape === 'omni'
        ? [['radius', 1]]
        : [
            ['radius', 1],
            ['rotate', 1],
            ['angle', 1],
            ['angle', -1],
          ];
    for (const [handle, side] of handles) {
      const at = coverageHandlePoint(view, handle, side);
      consider(view, handle, Math.hypot(point.x - at.x, point.y - at.y), handleTolerance);
    }
  }
  if (best) return best;

  // 2) 边缘（隐形热区）
  if (edgeAllowed) {
    for (const view of views) {
      const arc = arcDistance(view, point);
      if (arc !== null) consider(view, 'radius', arc, toleranceWorld);
      for (const side of [1, -1] as const) {
        const radial = radialDistance(view, point, side, toleranceWorld);
        if (radial !== null) consider(view, 'rotate', radial, toleranceWorld);
      }
    }
  }
  return best;
}

/** 拖半径：指针到圆心的距离（米），钳制到合法范围 */
export function radiusFromPointer(view: CoverageView, point: Point): number {
  const world = Math.hypot(point.x - view.center.x, point.y - view.center.y);
  return Math.round(clampCoverageRadius(worldToMeters(world)));
}

/** 拖开合角：指针相对角平分线的夹角 × 2（扇形两侧对称张开） */
export function angleFromPointer(view: CoverageView, point: Point): number {
  const delta = angleDeltaDeg(bearingDeg(view.center, point), view.azimuthDeg);
  // 贴住角平分线时给下限，避免"拖到中心把扇形收成一条线"
  return Math.round(clampSectorAngle(Math.max(delta * 2, 1)));
}

/** 拖朝向：把方位角按抓取时的偏移量对齐，拖动过程中扇形不会跳 */
export function azimuthFromPointer(view: CoverageView, point: Point, grabOffsetDeg = 0): number {
  return Math.round(normalizeAzimuth(bearingDeg(view.center, point) - grabOffsetDeg));
}

/** 拖动开始时记下的"指针方位角 − 当前朝向"，用于朝向拖拽的增量计算 */
export function azimuthGrabOffset(view: CoverageView, point: Point): number {
  return bearingDeg(view.center, point) - view.azimuthDeg;
}

/** 把覆盖视图换算回可写回 schema 的覆盖配置 */
export function patchFromDrag(
  view: CoverageView,
  patch: { radiusM?: number; angleDeg?: number; azimuthDeg?: number },
): RadioCoverage {
  const radiusM = clampCoverageRadius(patch.radiusM ?? view.coverage.radiusM);
  if (view.shape === 'omni') return { ...view.coverage, shape: 'omni', radiusM };
  return {
    ...view.coverage,
    shape: 'sector',
    radiusM,
    angleDeg: clampSectorAngle(patch.angleDeg ?? view.coverage.angleDeg ?? 90),
    azimuthDeg: normalizeAzimuth(patch.azimuthDeg ?? view.coverage.azimuthDeg ?? 0),
  };
}
