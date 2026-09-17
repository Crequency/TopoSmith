/**
 * 画布几何工具：对齐、分布、吸附、框选判定
 *
 * 全部是纯函数（不依赖 Canvas、不依赖 World），因此可以被单元测试直接覆盖 ——
 * 几何逻辑的 bug 表现为"对不齐、吸不住"，靠肉眼调试代价极高。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 设备卡片尺寸（世界坐标）；画布渲染与对齐计算共用同一份定义 */
export const NODE_W = 152;
export const NODE_H = 86;

/** 网格间距（世界坐标） */
export const GRID_SIZE = 8;
/** 吸附判定阈值（世界坐标，调用方需按当前缩放换算：屏幕阈值 / k） */
export const SNAP_THRESHOLD = 7;

export function boxContainsPoint(box: Box, point: Point): boolean {
  return (
    point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h
  );
}

/** 框选判定：相交即选中（与主流设计工具一致，比"完全包含"更好用） */
export function boxIntersects(a: Box, b: Box): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function normalizeBox(from: Point, to: Point): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  };
}

export function boxesBounds(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/* ────────────────────────────── 对齐 ────────────────────────────── */

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y';

/**
 * 对齐：以选区包围盒为基准。
 * 返回与入参等长的"新左上角坐标"数组（顺序不变），调用方据此更新设备坐标。
 */
export function alignBoxes(boxes: Box[], mode: AlignMode): Point[] {
  const bounds = boxesBounds(boxes);
  if (!bounds) return [];

  return boxes.map((box) => {
    switch (mode) {
      case 'left':
        return { x: bounds.x, y: box.y };
      case 'right':
        return { x: bounds.x + bounds.w - box.w, y: box.y };
      case 'center-x':
        return { x: bounds.x + bounds.w / 2 - box.w / 2, y: box.y };
      case 'top':
        return { x: box.x, y: bounds.y };
      case 'bottom':
        return { x: box.x, y: bounds.y + bounds.h - box.h };
      case 'center-y':
        return { x: box.x, y: bounds.y + bounds.h / 2 - box.h / 2 };
      default:
        return { x: box.x, y: box.y };
    }
  });
}

/* ────────────────────────────── 分布 ────────────────────────────── */

export type DistributeAxis = 'horizontal' | 'vertical';

/**
 * 等间距分布：首尾两项保持不动，中间各项按**相等的间隙**重新排布。
 * 少于 3 项时（没有可移动的中间项）原样返回。
 */
export function distributeBoxes(boxes: Box[], axis: DistributeAxis): Point[] {
  const positions = boxes.map((box) => ({ x: box.x, y: box.y }));
  if (boxes.length < 3) return positions;

  const horizontal = axis === 'horizontal';
  const size = horizontal ? (b: Box) => b.w : (b: Box) => b.h;
  const start = horizontal ? (b: Box) => b.x : (b: Box) => b.y;

  // 排序时用下标稳定的比较，避免同坐标项顺序抖动（确定性）
  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => (start(a.box) - start(b.box)) || (a.index - b.index));

  const first = order[0]!;
  const last = order[order.length - 1]!;
  const span = start(last.box) + size(last.box) - start(first.box);
  const sumSize = order.reduce((acc, item) => acc + size(item.box), 0);
  const gap = (span - sumSize) / (order.length - 1);

  let cursor = start(first.box);
  for (const item of order) {
    const value = cursor;
    if (horizontal) positions[item.index] = { x: value, y: item.box.y };
    else positions[item.index] = { x: item.box.x, y: value };
    cursor += size(item.box) + gap;
  }
  return positions;
}

/* ────────────────────────────── 吸附 ────────────────────────────── */

export interface SnapGuides {
  /** 需要绘制竖直引导线的世界坐标 X */
  vertical: number[];
  /** 需要绘制水平引导线的世界坐标 Y */
  horizontal: number[];
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuides;
}

export function snapToGrid(value: number, grid = GRID_SIZE): number {
  return Math.round(value / grid) * grid;
}

interface AxisSnap {
  delta: number;
  line: number | null;
}

/**
 * 单轴吸附：在"对齐到其他节点（左/中/右 或 上/中/下）"与"对齐到网格"之间取最近的一个。
 * 平票时优先节点对齐 —— 用户拖到另一个节点旁边时，意图通常是"对齐它"而不是"对齐网格"。
 */
function snapAxis(
  edges: number[],
  targets: number[],
  value: number,
  threshold: number,
  grid: number | null,
): AxisSnap {
  let best: AxisSnap = { delta: 0, line: null };
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const edge of edges) {
    for (const target of targets) {
      const delta = target - edge;
      const distance = Math.abs(delta);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        best = { delta, line: target };
      }
    }
  }

  if (grid && grid > 0) {
    const snapped = snapToGrid(value, grid);
    const delta = snapped - value;
    if (Math.abs(delta) <= threshold && Math.abs(delta) < bestDistance) {
      best = { delta, line: snapped };
    }
  }

  return best;
}

/**
 * 计算拖拽中的吸附位移。
 *
 * @param moving    被拖动内容当前的包围盒（多选时为整体包围盒）
 * @param others    其他节点的包围盒（不含被拖动者）
 * @param threshold 吸附阈值（世界坐标）
 * @param grid      网格间距；传 null 关闭网格吸附
 */
export function computeSnap(
  moving: Box,
  others: Box[],
  threshold = SNAP_THRESHOLD,
  grid: number | null = GRID_SIZE,
): SnapResult {
  const xTargets: number[] = [];
  const yTargets: number[] = [];
  for (const box of others) {
    xTargets.push(box.x, box.x + box.w / 2, box.x + box.w);
    yTargets.push(box.y, box.y + box.h / 2, box.y + box.h);
  }

  const x = snapAxis([moving.x, moving.x + moving.w / 2, moving.x + moving.w], xTargets, moving.x, threshold, grid);
  const y = snapAxis([moving.y, moving.y + moving.h / 2, moving.y + moving.h], yTargets, moving.y, threshold, grid);

  return {
    dx: x.delta,
    dy: y.delta,
    guides: {
      vertical: x.line === null ? [] : [x.line],
      horizontal: y.line === null ? [] : [y.line],
    },
  };
}

/* ────────────────────────────── 机柜容器几何（FR-36） ────────────────────────────── */

/**
 * 每 U 的高度。
 *
 * 取 (NODE_H + 6) / 4 —— 也就是**一张标准卡片在视觉上等于 4U**，
 * 机柜看起来才是真实机柜的比例（此前 1U = 一整张卡片，格子太粗）。
 */
const RACK_UNIT_H_RAW = (NODE_H + 6) / 4;
export const RACK_UNIT_H = Math.round(RACK_UNIT_H_RAW);

/**
 * 真实 19″ 机架的宽高比：设备宽 482.6 mm ÷ 1U 高 44.45 mm ≈ 10.86。
 *
 * 这个比例是"机柜看起来像不像真的"的关键 —— 之前的宽度按卡片宽度（152）反推，
 * 结果宽高比只有 6.6，机柜显得又瘦又高。现在由 U 高反推设备宽度。
 */
export const RACK_ASPECT = 482.6 / 44.45;
/** 机柜标题栏高度（含翻转按钮） */
export const RACK_HEADER_H = 32;
/** 机柜底部留白 */
export const RACK_FOOTER_H = 12;
/** 机柜左右边框 */
export const RACK_PAD_X = 12;
/** U 标号栏宽度（装在左右导轨上） */
export const RACK_RAIL_W = 18;
/**
 * 上架设备的面板宽度（世界坐标）＝ U 高 × 真实宽高比。
 * 也就是"19 英寸设备"的宽度：上架后的卡片宽度与它一致，而不是标准卡片的 152。
 */
export const RACK_EQUIPMENT_W = Math.round(RACK_UNIT_H_RAW * RACK_ASPECT);
/** 机柜外框宽度：真实机柜外宽约为设备宽的 1.24 倍（导轨占两侧） */
export const RACK_W = Math.round(RACK_EQUIPMENT_W * 1.24);
/** 设备默认占用 4U（正好一张标准卡片的高度） */
export const DEFAULT_RACK_UNITS = 4;
/** 卡片要放下图标/名称/类型/地址/端口面板，最小 4U；最大 24U */
export const MIN_RACK_UNITS = DEFAULT_RACK_UNITS;
export const MAX_RACK_UNITS = 24;

/**
 * 卡片宽度可调范围（世界坐标，FR-49）。
 *
 * 下限 120：再窄就放不下"图标 + 名称 + 类型 + 地址"，端口也会被挤成两行以上；
 * 上限 420：比 19″ 设备面板（250）宽出一截，够放下长设备名与一排多口面板，
 * 又不至于宽到把画布变成一排横条。
 */
export const MIN_CARD_W = 120;
export const MAX_CARD_W = 420;

/** 把任意输入钳制到合法的卡片宽度（非数字回落到默认宽度） */
export function clampCardWidth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return NODE_W;
  return Math.round(Math.min(MAX_CARD_W, Math.max(MIN_CARD_W, value)));
}

export interface CardSized {
  rackUnits?: number;
  mount?: { rackId: string; startU: number };
  /** 自定义卡片宽度（世界坐标）；未设置则用 `NODE_W`（FR-49） */
  cardWidth?: number;
}

/** 设备卡片占用的 U 数（缺省 4U） */
export function rackUnitsOf(device: CardSized): number {
  const units = Math.round(device.rackUnits ?? DEFAULT_RACK_UNITS);
  if (!Number.isFinite(units)) return 1;
  return Math.min(MAX_RACK_UNITS, Math.max(MIN_RACK_UNITS, units));
}

/** 占 units 个 U 的卡片高度（4U 恰好等于标准卡片高度） */
export function cardHeightForUnits(units: number): number {
  return Math.max(NODE_H, units * RACK_UNIT_H - 6);
}

/** 设备卡片实际高度：**按占用 U 数变化**，而不是固定 NODE_H */
export function cardHeightOf(device: CardSized): number {
  return cardHeightForUnits(rackUnitsOf(device));
}

/**
 * 设备卡片实际宽度。
 *
 * 上架后**跟随机柜的设备面板宽度**（19 英寸设备宽度）—— 宽高都随机柜走，
 * 卡片才像"装在机柜里的设备"；未上架时用 `device.cardWidth`（用户可调，FR-49），
 * 缺省为标准卡片宽度。**上架设备不参与宽度调整**：它的宽度由机柜决定，
 * 允许改会造成"卡片比导轨还宽"这类自相矛盾的状态。
 */
export function cardWidthOf(device: CardSized): number {
  if (device.mount) return RACK_EQUIPMENT_W;
  return device.cardWidth === undefined ? NODE_W : clampCardWidth(device.cardWidth);
}

/**
 * 可调宽度设备的右边缘（世界坐标，FR-49）。
 *
 * 顶部留出 `CARD_RESIZE_TOP_INSET` 让开卡片右上角的**翻转按钮**：
 * 两个热区如果重叠，"想翻面却把卡片拉宽了"就会变成常见事故。
 * 机柜与已上架设备返回 null（宽度由机柜决定）。
 */
export interface CardResizeEdge {
  /** 边缘的 x（世界坐标） */
  x: number;
  top: number;
  bottom: number;
}

export const CARD_RESIZE_TOP_INSET = 28;
/** 边缘热区在屏幕上的半宽（像素）：太小不好抓，太大会和端口抢点击 */
export const CARD_RESIZE_TOL_PX = 5;

export function cardResizeEdge(device: {
  x: number;
  y: number;
  kind: string;
  rackUnits?: number;
  mount?: { rackId: string; startU: number };
  cardWidth?: number;
}): CardResizeEdge | null {
  if (device.kind === 'rack' || device.mount) return null;
  const rect = deviceRect(device);
  const top = rect.y + CARD_RESIZE_TOP_INSET;
  const bottom = rect.y + rect.h - 4;
  if (bottom - top < 8) return null;
  return { x: rect.x + rect.w, top, bottom };
}

/** 设备卡片矩形（不含机柜容器） */
export function deviceRect(device: CardSized & { x: number; y: number }): Box {
  return { x: device.x, y: device.y, w: cardWidthOf(device), h: cardHeightOf(device) };
}

/**
 * 命中与框选用的矩形。
 *
 * 机柜是**高瘦容器**（24U 约 600 单位高、310 宽），沿用卡片的 152×86 会让
 * 标题栏的翻转按钮落在命中区之外而点不到 —— 这里按类型区分。
 */
export function hitRect(device: {
  x: number;
  y: number;
  kind: string;
  rackUnits?: number;
  mount?: { rackId: string; startU: number };
  cardWidth?: number;
  rack?: { heightU: number; flipped: boolean };
}): Box {
  if (device.kind === 'rack') return rackRect(device);
  return deviceRect(device);
}

export interface RackLike {
  x: number;
  y: number;
  rack?: { heightU: number; flipped: boolean };
}

export function rackHeightU(rack: RackLike): number {
  return Math.max(1, Math.round(rack.rack?.heightU ?? 12));
}

/** 机柜整体外框高度 */
export function rackHeight(rack: RackLike): number {
  return RACK_HEADER_H + rackHeightU(rack) * RACK_UNIT_H + RACK_FOOTER_H;
}

export function rackRect(rack: RackLike): Box {
  return { x: rack.x, y: rack.y, w: RACK_W, h: rackHeight(rack) };
}

/** 机柜高度范围（U） */
export const MIN_RACK_HEIGHT_U = 8;
export const MAX_RACK_HEIGHT_U = 48;
export const DEFAULT_RACK_HEIGHT_U = 24;

/** 从第 startU 位起、占 units 个 U 的内容区（卡片落位处） */
export function rackSlotContentBox(rack: RackLike, startU: number, units = 1): Box {
  const top = rack.y + RACK_HEADER_H + (startU - 1) * RACK_UNIT_H;
  const height = cardHeightForUnits(units);
  return {
    // 设备面板正好铺满两导轨之间的宽度（19 英寸设备）
    x: rack.x + RACK_PAD_X + RACK_RAIL_W,
    y: top + (units * RACK_UNIT_H - height) / 2,
    w: RACK_EQUIPMENT_W,
    h: height,
  };
}

/** 卡片的左上角坐标（挂载到第 startU 位，占 units 个 U） */
export function rackMountPosition(rack: RackLike, startU: number, units = 1): Point {
  const box = rackSlotContentBox(rack, startU, units);
  return { x: Math.round(box.x), y: Math.round(box.y) };
}

/** 世界坐标 Y 落在第几个 U（1 起，超出范围会被钳制） */
export function rackSlotAt(rack: RackLike, worldY: number): number {
  const offset = worldY - (rack.y + RACK_HEADER_H);
  const raw = Math.floor(offset / RACK_UNIT_H) + 1;
  return Math.min(rackHeightU(rack), Math.max(1, raw));
}

export function rackContainsPoint(rack: RackLike, x: number, y: number): boolean {
  const rect = rackRect(rack);
  return boxContainsPoint(rect, { x, y });
}

/** 设备卡片右上角的翻转按钮（尺寸与机柜按钮一致） */
export function deviceFlipButtonRect(device: { x: number; y: number; w?: number }): Box {
  const width = device.w ?? NODE_W;
  return {
    x: device.x + width - RACK_PAD_X - RACK_FLIP_BUTTON.w,
    y: device.y + 6,
    w: RACK_FLIP_BUTTON.w,
    h: RACK_FLIP_BUTTON.h,
  };
}

/** 标题栏右侧的翻转按钮（只放一个翻转图标，所以做成方形小按钮） */
export const RACK_FLIP_BUTTON = { w: 26, h: 20 };

export function rackFlipButtonRect(rack: RackLike): Box {
  return {
    x: rack.x + RACK_W - RACK_PAD_X - RACK_FLIP_BUTTON.w,
    y: rack.y + (RACK_HEADER_H - RACK_FLIP_BUTTON.h) / 2,
    w: RACK_FLIP_BUTTON.w,
    h: RACK_FLIP_BUTTON.h,
  };
}

/** 挂载时寻找第一个能容纳 heightU 个 U 的空位；没有空位返回 null */
export function findFreeSlot(
  rack: RackLike,
  occupied: { startU: number; heightU: number }[],
  heightU = 1,
  preferredStartU?: number,
): number | null {
  const total = rackHeightU(rack);
  const taken = (startU: number): boolean =>
    occupied.some(
      (item) => startU < item.startU + item.heightU && item.startU < startU + heightU,
    );

  const fits = (startU: number) => startU >= 1 && startU + heightU - 1 <= total && !taken(startU);

  if (preferredStartU !== undefined && fits(preferredStartU)) return preferredStartU;
  // 没有首选位置：从第 1U 自上而下找第一个空位
  if (preferredStartU === undefined) {
    for (let startU = 1; startU + heightU - 1 <= total; startU += 1) {
      if (fits(startU)) return startU;
    }
    return null;
  }
  // 有首选位置：以它为原点上下交替扩展，视觉上贴着用户放下的位置
  for (let delta = 1; delta <= total; delta += 1) {
    if (fits(preferredStartU + delta)) return preferredStartU + delta;
    if (fits(preferredStartU - delta)) return preferredStartU - delta;
  }
  return null;
}
