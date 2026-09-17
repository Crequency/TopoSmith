/**
 * 侧栏页面布局（纯函数，FR-69 / FR-70）
 *
 * 每个侧栏由若干**页面**（page）组成，每页是一整块内容：
 *  · **左侧栏**用**页签**切换（页签是页面的标题，也是拖拽手柄）—— 设备目录与节点树
 *    共享同一块空间，一次看一个；这与 VSCode 的主侧栏（一次显示一个视图容器）一致。
 *  · **右侧栏**把页面**上下堆叠**、按权重分配高度、相邻页面之间可拖 ——
 *    因为检查器与诊断要同时可见（FR-60），页签会把其中一块藏起来。
 *  两种排布方式并存不是权宜：左栏是"二选一的工作区"，右栏是"两块常驻面板"。
 *
 * 这些计算全部抽成纯函数放在这里，原因有两个：
 *  1. 指针拖拽最容易出的错（插入位差一格、越界、把某一块拖没）都能用单测钉住，
 *     不必靠手点画布才发现；
 *  2. 布局要落盘（localStorage），存的是**数据**，读写与迁移也需要可测的纯逻辑。
 */

/* ────────────────────────────── 页面登记表 ────────────────────────────── */

export type SidebarSide = 'left' | 'right';

export interface CardMeta {
  id: string;
  title: string;
  /** 默认所在侧 */
  side: SidebarSide;
}

/**
 * 页面的**默认**归属与顺序（用户改过的顺序存在 localStorage 里）。
 *
 * 左侧两页：设备目录（全部分组在一页里滚动）与节点树 —— 它们共享左侧空间，用页签切换。
 * 右侧两页：检查器与诊断 —— 上下堆叠、高度按权重分配（保 FR-60）。
 */
export const DEFAULT_CARDS: CardMeta[] = [
  { id: 'palette', title: '设备目录', side: 'left' },
  { id: 'tree', title: '节点树', side: 'left' },
  { id: 'inspector', title: '检查器', side: 'right' },
  { id: 'diagnostics', title: '连通性诊断', side: 'right' },
];

export const CARD_IDS = DEFAULT_CARDS.map((card) => card.id);

export function cardTitle(cardId: string): string {
  return DEFAULT_CARDS.find((card) => card.id === cardId)?.title ?? cardId;
}

/** 右侧栏的默认权重：1.1 : 1.4 ≈ 44% : 56%（与 FR-60 的默认分割一致） */
export const DEFAULT_RIGHT_WEIGHTS: Record<string, number> = {
  inspector: 1.1,
  diagnostics: 1.4,
};

/** 左侧栏默认显示哪一页（设备目录，与旧版默认页签一致） */
export const DEFAULT_ACTIVE_LEFT = 'palette';

/* ────────────────────────────── 侧栏宽度 ────────────────────────────── */

/** 侧栏宽度下限：再窄就看不清设备名了 */
export const SIDEBAR_MIN_W = 180;
/** 侧栏宽度上限（用户手动能拖到的最宽） */
export const SIDEBAR_MAX_W = 560;
/** 画布至少要留下的宽度：拖侧栏不能把画布挤没 */
export const MIN_CANVAS_W = 360;

export const DEFAULT_LEFT_W = 240;
export const DEFAULT_RIGHT_W = 380;

export interface SidebarWidthOptions {
  /** 浏览器窗口宽度 */
  windowPx: number;
  /** 另一侧侧栏的当前宽度（画布不是唯一被挤压的对象） */
  oppositePx: number;
}

/**
 * 把侧栏宽度夹进合法区间。
 *
 * 上限是三者的最小：用户上限、窗口留给画布后的余量。窗口很窄时可能出现
 * "合法区间为空"的情况 —— 这时退化为下限（宁可挤画布，也不让侧栏消失到看不见）。
 */
/** 当前窗口下这一侧能到的最宽值（aria-valuemax 与夹取共用同一份算法） */
export function sidebarMaxWidth(options: SidebarWidthOptions): number {
  const { windowPx, oppositePx } = options;
  if (!Number.isFinite(windowPx) || windowPx <= 0) return SIDEBAR_MAX_W;
  const room = windowPx - (Number.isFinite(oppositePx) ? oppositePx : 0) - MIN_CANVAS_W;
  return Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, Math.floor(room)));
}

export function clampSidebarWidth(width: number, options: SidebarWidthOptions): number {
  if (!Number.isFinite(width)) return SIDEBAR_MIN_W;
  const max = sidebarMaxWidth(options);
  return Math.round(Math.max(SIDEBAR_MIN_W, Math.min(max, width)));
}

/* ────────────────────────── 卡片顺序与拖拽插入位 ────────────────────────── */

/**
 * 把 `cardId` 移动到列表的 `index` 位置（**移除之后**的下标语义）。
 *
 * 语义刻意规定为"先移除、再按移除后的下标插入"：拖拽时算出来的插入位就是
 * "松手后它会落在第几个"，而不是"插在原来第几个元素之前" —— 后者在同一列表里
 * 向下拖动时会差一格，是最常见的手感 bug。
 */
export function moveCardIds(list: string[], cardId: string, index: number): string[] {
  const without = list.filter((id) => id !== cardId);
  const clamped = Math.max(0, Math.min(without.length, Math.round(index)));
  return [...without.slice(0, clamped), cardId, ...without.slice(clamped)];
}

export interface CardBox {
  /** 元素在容器内的纵向区间（像素） */
  top: number;
  height: number;
}

/**
 * 指针落在哪个插入位：与每个落点（页签 / 面板标题）的**中线**比较。
 *
 * 返回 0‥n（n = 卡片数），正好是 `moveCardIds` 需要的下标语义。
 */
export function insertionIndex(pointerY: number, boxes: CardBox[]): number {
  let index = 0;
  for (const box of boxes) {
    if (pointerY > box.top + box.height / 2) index += 1;
  }
  return index;
}

/* ─────────────────── 右侧栏：可拖动的分割（FR-60 的推广） ─────────────────── */

/** 一块面板的最小高度（像素）：低于它面板里连一行都显示不全（FR-60 的约定） */
export const MIN_PANE_PX = 132;

/**
 * 拖动两张相邻卡片之间的分隔条之后，这两张卡片各自的新权重。
 *
 * 权重按 `flexGrow` 分配容器高度，所以"边界落在 pointerY"这件事等价于
 * "上面那张卡片的权重占两者之和的 pointerY 比例"。两块的最小高度由 `minPx` 保证 ——
 * 这就是 FR-60 里 `clampPaneRatio` 的推广形式（原来是两块固定比例，现在是 N 块权重）。
 */
export function weightsFromBoundary(
  pair: [number, number],
  options: { regionPx: number; pointerOffsetPx: number; minPx?: number },
): [number, number] {
  const { regionPx, pointerOffsetPx, minPx = MIN_PANE_PX } = options;
  const [above, below] = pair;
  const total = above + below;
  if (!Number.isFinite(regionPx) || regionPx <= 0 || total <= 0) return [above, below];

  const minRatio = Math.min(0.5, minPx / regionPx);
  const ratio = Math.max(minRatio, Math.min(1 - minRatio, pointerOffsetPx / regionPx));
  return [total * ratio, total * (1 - ratio)];
}

/* ────────────────────────────── 布局读写 ────────────────────────────── */

export interface UiLayout {
  /** 左右两侧的卡片顺序（卡片的"归属"由它决定，不再看默认值） */
  left: string[];
  right: string[];
  /** 左侧栏当前显示哪一页（页签选中项） */
  activeLeft: string;
  /** 折叠状态（只对右侧栏的堆叠页面有意义，缺省 = 展开） */
  collapsed: Record<string, boolean>;
  /** 右侧栏各页面的权重 */
  weights: Record<string, number>;
  leftWidth: number;
  rightWidth: number;
}

export const LAYOUT_STORAGE_KEY = 'toposmith.ui.layout.v1';
/** FR-60 时代的分割比例（迁移用：老用户的高度偏好不该在升级后丢掉） */
export const LEGACY_SPLIT_KEY = 'toposmith.ui.sidebarSplit';

/**
 * 默认折叠的页面：右侧栏一个都不折。
 *
 * 左栏不需要折叠概念 —— 页签本身就是"一次只看一页"。折叠只用于右侧栏的堆叠页面
 * （把不常看的诊断收起来，给检查器让高度）。
 */
export const DEFAULT_COLLAPSED: Record<string, boolean> = {};

/** 默认布局：页面按登记表归位，宽度取当前界面的实测值 */
export function defaultLayout(): UiLayout {
  return {
    left: DEFAULT_CARDS.filter((card) => card.side === 'left').map((card) => card.id),
    right: DEFAULT_CARDS.filter((card) => card.side === 'right').map((card) => card.id),
    activeLeft: DEFAULT_ACTIVE_LEFT,
    collapsed: { ...DEFAULT_COLLAPSED },
    weights: { ...DEFAULT_RIGHT_WEIGHTS },
    leftWidth: DEFAULT_LEFT_W,
    rightWidth: DEFAULT_RIGHT_W,
  };
}

/**
 * 把任意（可能被手工改坏、或来自旧版本）的输入整理成合法布局。
 *
 * 三条不变量：卡片不重复、不丢失、不凭空出现；这样"读到一个坏存档"最多是顺序退回默认，
 * 而不是整块面板消失。
 */
export function normalizeLayout(input: unknown, legacyRatio?: number | null): UiLayout {
  const base = defaultLayout();
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Partial<UiLayout>;

  const seen = new Set<string>();
  // 先把存档里两条链表的合法 id 收下来（**不做补全**，否则一张被拖到右侧的卡片
  // 会因为"默认在左侧"被补回左边，跨栏移动等于白做）
  const takeIds = (value: unknown): string[] => {
    const list = Array.isArray(value) ? value : [];
    const out: string[] = [];
    for (const id of list) {
      if (typeof id !== 'string') continue;
      if (!CARD_IDS.includes(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };

  const left = takeIds(raw.left);
  const right = takeIds(raw.right);
  // 没被任何一侧提到的卡片（新版本新增的卡片、或存档被改坏）：按默认侧补回去
  for (const card of DEFAULT_CARDS) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    (card.side === 'left' ? left : right).push(card.id);
  }

  /*
   * 折叠状态：**存档里有这一项就以存档为准**（用户把节点树展开过 → 里面没有 tree，
   * 那就该保持展开）；存档里没有这一项（第一次打开 / 老存档）才用默认折叠。
   * 这两种情况必须区分，否则"用户展开过"会被默认值一次次摁回去。
   */
  const collapsed: Record<string, boolean> = {};
  if (typeof raw.collapsed === 'object' && raw.collapsed !== null) {
    for (const [id, value] of Object.entries(raw.collapsed)) {
      if (CARD_IDS.includes(id) && value === true) collapsed[id] = true;
    }
  } else {
    Object.assign(collapsed, base.collapsed);
  }

  const weights: Record<string, number> = { ...base.weights };
  if (typeof raw.weights === 'object' && raw.weights !== null) {
    for (const [id, value] of Object.entries(raw.weights)) {
      if (!CARD_IDS.includes(id)) continue;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) weights[id] = value;
    }
  } else if (typeof legacyRatio === 'number' && Number.isFinite(legacyRatio)) {
    // 旧版只有一个"上/下比例"：把它还原成检查器与诊断两块权重
    const ratio = Math.max(0.05, Math.min(0.95, legacyRatio));
    weights['inspector'] = ratio;
    weights['diagnostics'] = 1 - ratio;
  }

  return {
    left,
    right,
    // 选中的页签必须真的在左侧栏里：页签会被拖走，落盘时可能指着已搬走的页面
    activeLeft:
      typeof raw.activeLeft === 'string' && left.includes(raw.activeLeft)
        ? raw.activeLeft
        : (left[0] ?? DEFAULT_ACTIVE_LEFT),
    collapsed,
    weights,
    leftWidth:
      typeof raw.leftWidth === 'number' && Number.isFinite(raw.leftWidth)
        ? Math.round(raw.leftWidth)
        : base.leftWidth,
    rightWidth:
      typeof raw.rightWidth === 'number' && Number.isFinite(raw.rightWidth)
        ? Math.round(raw.rightWidth)
        : base.rightWidth,
  };
}
