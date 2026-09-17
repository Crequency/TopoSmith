/**
 * 应用状态（zustand 单一 store）
 *
 * 唯一事实源是 `scenario`（拓扑）；`world` 是**派生**的，每次拓扑变更后重算。
 * 派生世界不进持久化 —— 于是"结果永远与事实一致"，不存在把过期推演结果写进文件的风险
 * （docs/04-architecture.md §4）。
 */

import { create } from 'zustand';
import {
  defaultDeviceName,
  defaultPortModule,
  defaultPortRole,
  defaultPortSpeed,
  instantiate,
  isRackable,
  portIdFor,
  suggestPortName,
  templateByKey,
} from '@toposmith/catalog';
import {
  bandwidth as runBandwidth,
  buildWorld,
  dnsPath as runDnsPath,
  negotiateLink,
  pathTrace as runPathTrace,
  ping as runPing,
  type DiagResult,
  type DnsSessionCache,
  type World,
} from '@toposmith/engine';
import {
  parseScenarioJson,
  type Cable,
  type CableType,
  type Device,
  type Port,
  type PortMedium,
  type PortRole,
  type PortSide,
  type Scenario,
} from '@toposmith/schema';
import { History } from '../lib/history';
import {
  NODE_H,
  NODE_W,
  MAX_RACK_HEIGHT_U,
  MAX_RACK_UNITS,
  MIN_RACK_HEIGHT_U,
  MIN_RACK_UNITS,
  alignBoxes,
  cardHeightOf,
  cardWidthOf,
  distributeBoxes,
  findFreeSlot,
  rackContainsPoint,
  rackMountPosition,
  rackUnitsOf,
  snapToGrid,
  type AlignMode,
  type Box,
  type DistributeAxis,
} from '../lib/geometry';
import { MAX_ZOOM, MIN_ZOOM, computeFit, worldContentBounds } from '../lib/fit';
import { clampCardWidth } from '../lib/geometry';
import {
  DEFAULT_PRESET_KEY,
  buildEmptyScenario,
  presetByKey,
} from '../scenarios';

const STORAGE_KEY = 'toposmith.scenario.v1';

/** 各类线缆的默认长度（米）—— 用户可改，这里只是合理的起点 */
export const DEFAULT_LENGTH: Record<CableType, number> = {
  cat5: 10,
  cat5e: 10,
  cat6: 10,
  cat6a: 10,
  'lc-om3': 100,
  'lc-om4': 150,
  'lc-sm': 1000,
  dac: 3,
  wireless: 0,
};

/** 尊重系统的"减少动态效果"设置（NFR-10 可访问性的一部分） */
export const PREFERS_REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ────────────────────────────── 选择 ────────────────────────────── */

export interface Selection {
  devices: string[];
  cables: string[];
  /** 单独选中某个端口（点击端口图元），用于编辑端口详情 */
  port?: { deviceId: string; portId: string };
}

export const EMPTY_SELECTION: Selection = { devices: [], cables: [] };

export function selectionCount(selection: Selection): number {
  return selection.devices.length + selection.cables.length + (selection.port ? 1 : 0);
}

export function isDeviceSelected(selection: Selection, deviceId: string): boolean {
  return selection.devices.includes(deviceId);
}

export function isCableSelected(selection: Selection, cableId: string): boolean {
  return selection.cables.includes(cableId);
}

export function isPortSelected(
  selection: Selection,
  deviceId: string,
  portId: string,
): boolean {
  return selection.port?.deviceId === deviceId && selection.port.portId === portId;
}

/** 撤销/重做的可用状态（UI 需要响应式地灰显按钮） */
export interface HistoryInfo {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

/* ────────────────────────────── 视图 / 动画 ────────────────────────────── */

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export interface LinkDraft {
  deviceId: string;
  portId: string;
}

export interface Toast {
  text: string;
  level: 'info' | 'warn' | 'error';
}

export interface AnimationState {
  /** 每次运行诊断或手动重放都会自增，画布据此重置粒子 */
  token: number;
  playing: boolean;
  /** 播放倍率 */
  rate: number;
}

export interface DiagState {
  srcId: string;
  dstIp: string;
  dnsName: string;
  /** 当源/目标是由"选中两台设备"自动填入时，记录来源用于 UI 提示 */
  fromSelection?: { srcId: string; dstId: string };
  result: DiagResult | null;
  /** 结果产生时的场景版本，用于提示"拓扑已改动，结果可能过期" */
  ranOn: string | null;
  cache: DnsSessionCache;
}

interface AppState {
  scenario: Scenario;
  world: World;
  selection: Selection;
  viewport: Viewport;
  /** 画布可视区尺寸（由画布上报）：节点树的"定位到设备"需要它来居中 */
  canvasSize: { width: number; height: number };
  linkMode: boolean;
  linkDraft: LinkDraft | null;
  cableDefaults: { type: CableType; lengthM: number };
  /** 网格吸附开关（按住 Alt 可临时关闭） */
  snapEnabled: boolean;
  diag: DiagState;
  animation: AnimationState;
  history: HistoryInfo;
  toast: Toast | null;

  /* 视图与选择 */
  select: (selection: Selection) => void;
  selectOneDevice: (deviceId: string | null) => void;
  selectOneCable: (cableId: string) => void;
  selectPort: (deviceId: string, portId: string) => void;
  setSnapEnabled: (enabled: boolean) => void;
  toggleDevice: (deviceId: string) => void;
  toggleCable: (cableId: string) => void;
  selectManyDevices: (deviceIds: string[]) => void;
  clearSelection: () => void;
  setViewport: (viewport: Viewport) => void;
  setCanvasSize: (size: { width: number; height: number }) => void;
  /** 选中某设备并把视口居中到它（节点树双击用） */
  focusDevice: (deviceId: string) => void;
  zoomAt: (factor: number, screenX: number, screenY: number) => void;
  fitView: () => void;

  /* 连线 */
  setLinkMode: (on: boolean) => void;
  clickPort: (deviceId: string, portId: string) => void;
  cancelLink: () => void;
  setCableDefaults: (patch: Partial<{ type: CableType; lengthM: number }>) => void;

  /* 拓扑编辑 */
  addDevice: (templateKey: string, x: number, y: number) => void;
  moveDevices: (
    moves: { deviceId: string; x: number; y: number }[],
    options?: { label?: string; mergeKey?: string },
  ) => void;
  patchDevice: (deviceId: string, fn: (device: Device) => void) => void;
  patchPort: (deviceId: string, portId: string, patch: Partial<Port>) => void;
  addPort: (
    deviceId: string,
    spec?: { medium?: PortMedium; speedMbps?: number; role?: PortRole; side?: PortSide },
  ) => void;
  removePort: (deviceId: string, portId: string) => void;
  patchCable: (cableId: string, patch: Partial<Cable>) => void;
  /**
   * 把"与对端之间的链路"整体设为 / 解除链路聚合（FR-66）。
   *
   * 聚合是**一对设备之间的组**，所以一次改的是同对端的所有线缆 ——
   * 一根线谈不上聚合，只改一根还会留下"孤零零的聚合成员"这种坏数据。
   */
  setBonded: (cableId: string, bonded: boolean) => void;
  removeCable: (cableId: string) => void;
  deleteSelection: () => void;
  alignSelection: (mode: AlignMode) => void;
  distributeSelection: (axis: DistributeAxis) => void;

  /* 机柜容器 */
  mountDevice: (deviceId: string, rackId: string, preferredStartU?: number) => void;
  unmountDevice: (deviceId: string) => void;
  flipRack: (rackId: string) => void;
  flipDevice: (deviceId: string) => void;
  setRackHeight: (rackId: string, heightU: number) => void;
  setDeviceRackUnits: (deviceId: string, units: number) => void;
  /** 调整未上架设备的卡片宽度（世界坐标，FR-49） */
  setDeviceWidth: (deviceId: string, width: number) => void;

  /* 撤销 / 重做 */
  beginHistory: (label: string) => void;
  commitHistory: () => void;
  undo: () => void;
  redo: () => void;
  loadScenario: (scenario: Scenario) => void;
  /** 载入某个预置场景（key 见 scenarios/index.ts 的 PRESETS） */
  loadPreset: (key: string) => void;
  resetScenario: () => void;
  clearScenario: () => void;
  exportJson: () => string;
  importJson: (text: string) => string | null;

  /* 诊断与动画 */
  setDiagSrc: (deviceId: string) => void;
  setDiagDst: (ip: string) => void;
  setDnsName: (name: string) => void;
  runDiag: (kind: 'ping' | 'trace' | 'bandwidth' | 'dns') => void;
  clearDnsCache: () => void;
  replayFlow: () => void;
  toggleFlow: () => void;
  setFlowRate: (rate: number) => void;

  showToast: (text: string, level?: Toast['level']) => void;
  dismissToast: () => void;
}

/* ────────────────────────────── 持久化 ────────────────────────────── */

function loadStoredScenario(): Scenario {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = parseScenarioJson(raw);
      if (parsed.ok) return parsed.scenario;
    }
  } catch {
    // 存档损坏不应阻塞应用启动：退回默认预置场景
  }
  // 没有任何存档（或存档坏了）：用登记表里的默认预置场景
  return (presetByKey(DEFAULT_PRESET_KEY)?.build() ?? buildEmptyScenario());
}

function persist(scenario: Scenario): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scenario));
    }
  } catch {
    // 存储配额或隐私模式：忽略，不影响本次会话
  }
}

/* ────────────────────────────── store ────────────────────────────── */

const initialScenario = loadStoredScenario();

function initialDiag(world: World): DiagState {
  // 默认源：第一台"有地址的终端设备"，用户一打开就能直接跑诊断
  const terminal = world.ordered.find(
    (device) => world.addresses.has(device.id) && device.client !== undefined,
  );
  // 默认目标：优先公网侧设备 —— 这样第一次点「可达性」就能看到 NAT 与逐跳路径
  const publicDevice = world.ordered.find(
    (device) => device.kind === 'cloud' && world.addresses.has(device.id),
  );
  return {
    srcId: terminal?.id ?? '',
    dstIp: publicDevice ? (world.addresses.get(publicDevice.id)?.[0]?.ip ?? '') : '',
    dnsName: 'www.example.com',
    result: null,
    ranOn: null,
    cache: new Map(),
  };
}

const initialWorld = buildWorld(initialScenario);

function deviceBox(device: Device): Box {
  return { x: device.x, y: device.y, w: cardWidthOf(device), h: cardHeightOf(device) };
}

/**
 * 生成"当前集合内唯一"的 id。
 *
 * 不能用 `Date.now()` 单独作后缀：同一毫秒内连续创建（脚本批量建图、拖入多台同型号设备）
 * 会得到相同 id —— 表现为 React key 冲突、`world.devices` 里互相覆盖（实测踩过）。
 */
function uniqueId(prefix: string, taken: Set<string>): string {
  const base = `${prefix}-${Date.now().toString(36)}`;
  let id = base;
  let attempt = 0;
  while (taken.has(id)) {
    attempt += 1;
    id = `${base}-${attempt}`;
  }
  return id;
}

/** 历史栈是模块级单例：它只在 store 的动作里被访问，不需要参与 React 渲染 */
const history = new History<Scenario>(60, 1200);

export const useApp = create<AppState>((set, get) => {
  const historyInfo = (): HistoryInfo => ({
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undoLabel: history.undoLabel,
    redoLabel: history.redoLabel,
  });

  /**
   * 拓扑变更的统一入口：克隆 → 改 → 记历史 → 存 → 重建世界。
   * 所有编辑动作都必须走这里，否则会出现"界面改了但推演没跟上"的漂移。
   *
   * @param options.label    显示在撤销提示里的操作名
   * @param options.mergeKey 相同 key 的连续改动在合并窗口内只记一条历史
   *                         （否则敲一次设备名会产生十几个历史条目）
   */
  /**
   * 拓扑变更的统一入口：克隆 → 改 → 记历史 → 存 → 重建世界。
   * 所有编辑动作都必须走这里，否则会出现"界面改了但推演没跟上"的漂移。
   *
   * @param options.label    显示在撤销提示里的操作名
   * @param options.mergeKey 相同 key 的连续改动在合并窗口内只记一条历史
   *                         （否则敲一次设备名会产生十几个历史条目）
   */
  const mutate = (
    fn: (draft: Scenario) => void,
    options: { label: string; mergeKey?: string; skipHistory?: boolean },
  ) => {
    const before = get().scenario;
    const next = structuredClone(before);
    fn(next);
    next.updatedAt = new Date().toISOString();
    if (!options.skipHistory) {
      history.record(before, { label: options.label, mergeKey: options.mergeKey });
    }
    // 拖动事务进行中不写 localStorage：800 台设备的场景一次就是 1 MB，
    // 每帧写一次会明显拖慢帧率；事务提交时统一落盘（见 commitHistory）
    if (!history.depth.inTransaction) persist(next);
    set({ scenario: next, world: buildWorld(next), history: historyInfo() });
  };

  /**
   * **位置专用**的快速变更入口（拖动设备的每一帧都会走这里）。
   *
   * 依据：设备坐标**不影响任何派生数据** —— 链路、地址、路由、广播域都只看端口与配置，
   * 不看卡片画在哪。所以拖动时只需要换掉设备对象，**不必重建整个世界**。
   * 800 台设备的场景里，一次完整 `buildWorld` 约 60 ms，而拖动是每帧一次：
   * 不区分的话，拖动就会掉到 3–10 FPS（实测过）。
   *
   * 与 `mutate` 的差别只有两点：① 浅克隆（只复制被改动的设备对象）；
   * ② 只更新 `world` 里的设备索引，链路段落原样复用。
   * 一旦改动**超出坐标范围**（增删设备、改配置、上下架），必须用 `mutate`。
   */
  const mutatePositions = (
    fn: (draft: Scenario) => void,
    options: { label: string; mergeKey?: string },
  ) => {
    const before = get().scenario;
    /*
     * 设备对象必须**逐个浅克隆**（写时复制）。
     *
     * 只复制数组是不够的：数组里还是同一批对象，`fn` 一改坐标，
     * 就把历史快照里那份"拖动前的状态"**一起改了** —— 于是撤销等于没撤
     * （实测：拖动 → 撤销后坐标仍是拖动后的值。这个 bug 是单测抓出来的）。
     *
     * 契约：`fn` 只能改设备自身的顶层字段（坐标、mount 这类），
     * 不能改 `ports`/`l3` 等嵌套结构 —— 浅克隆不保护嵌套对象。
     */
    const next: Scenario = {
      ...before,
      devices: before.devices.map((device) => ({ ...device })),
    };
    fn(next);
    next.updatedAt = new Date().toISOString();
    history.record(before, { label: options.label, mergeKey: options.mergeKey });

    const devices = new Map(next.devices.map((device) => [device.id, device]));
    const ordered = [...next.devices].sort((a, b) => a.id.localeCompare(b.id));
    const world = get().world;
    set({
      scenario: next,
      world: { ...world, scenario: next, devices, ordered },
      history: historyInfo(),
    });
  };

  /**
   * 选择变更的统一入口。
   *
   * 当选中 **2 台及以上**设备时，把**最后两台**自动填入连通性诊断面板：
   * 倒数第二台为源、最后一台为目标（即"先选中的是源设备"），
   * 并清空上一次的推演结果，避免用户看着过期结论。
   */
  const applySelection = (selection: Selection) => {
    const state = get();
    const patch: { selection: Selection; diag?: DiagState } = { selection };
    const devices = selection.devices;

    if (devices.length >= 2) {
      const srcId = devices[devices.length - 2] as string;
      const dstId = devices[devices.length - 1] as string;
      const srcName = state.world.devices.get(srcId)?.name ?? srcId;
      const dstName = state.world.devices.get(dstId)?.name ?? dstId;
      const dstAddress = state.world.addresses.get(dstId)?.[0]?.ip;
      patch.diag = {
        ...state.diag,
        srcId,
        dstIp: dstAddress ?? state.diag.dstIp,
        fromSelection: { srcId, dstId },
        result: null,
        ranOn: null,
      };
      if (dstAddress) {
        state.showToast(`已填入诊断：${srcName} → ${dstName}（${dstAddress}）`, 'info');
      } else {
        state.showToast(
          `${dstName} 还没有 IP 地址，已把它设为诊断目标但需要你补一个地址。`,
          'warn',
        );
      }
    } else if (state.diag.fromSelection) {
      // 选中不足两台：诊断面板不再代表"某一对设备"，撤掉来源标记
      patch.diag = {
        ...state.diag,
        fromSelection: undefined,
        ...(devices.length === 0 ? {} : {}),
      };
    }

    set(patch);
  };

  return {
    scenario: initialScenario,
    world: initialWorld,
    selection: EMPTY_SELECTION,
    viewport: { x: 40, y: 20, k: 1 },
    canvasSize: { width: 800, height: 600 },
    linkMode: false,
    linkDraft: null,
    cableDefaults: { type: 'cat6', lengthM: DEFAULT_LENGTH.cat6 },
    diag: initialDiag(initialWorld),
    animation: { token: 0, playing: false, rate: 1 },
    snapEnabled: true,
    history: { canUndo: false, canRedo: false },
    toast: null,

    /* ── 选择 ── */
    select: (selection) => applySelection(selection),

    setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),

    selectOneDevice: (deviceId) =>
      applySelection(deviceId ? { devices: [deviceId], cables: [] } : EMPTY_SELECTION),

    selectOneCable: (cableId) => applySelection({ devices: [], cables: [cableId] }),

    selectPort: (deviceId, portId) =>
      applySelection({ devices: [], cables: [], port: { deviceId, portId } }),

    /** Ctrl / Shift 点击：切换选中，**保持点击顺序** —— 最后两台会被填入诊断面板 */
    toggleDevice: (deviceId) => {
      const current = get().selection;
      const has = current.devices.includes(deviceId);
      applySelection({
        devices: has
          ? current.devices.filter((id) => id !== deviceId)
          : [...current.devices, deviceId],
        cables: current.cables,
      });
    },

    toggleCable: (cableId) => {
      const current = get().selection;
      const has = current.cables.includes(cableId);
      applySelection({
        devices: current.devices,
        cables: has
          ? current.cables.filter((id) => id !== cableId)
          : [...current.cables, cableId],
      });
    },

    selectManyDevices: (deviceIds) => applySelection({ devices: deviceIds, cables: [] }),

    clearSelection: () => applySelection(EMPTY_SELECTION),

    setViewport: (viewport) => set({ viewport }),

    setCanvasSize: (canvasSize) => set({ canvasSize }),

    focusDevice: (deviceId) => {
      const { world, canvasSize, viewport } = get();
      const device = world.devices.get(deviceId);
      if (!device) return;
      const k = Math.min(1.6, Math.max(0.7, viewport.k));
      const width = cardWidthOf(device);
      const height = cardHeightOf(device);
      applySelection({ devices: [deviceId], cables: [] });
      set({
        viewport: {
          k,
          x: canvasSize.width / 2 - (device.x + width / 2) * k,
          y: canvasSize.height / 2 - (device.y + height / 2) * k,
        },
      });
    },

    zoomAt: (factor, screenX, screenY) => {
      const { viewport } = get();
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.k * factor));
      // 以指针为锚点：保证缩放前后指针下的世界坐标不变
      const worldX = (screenX - viewport.x) / viewport.k;
      const worldY = (screenY - viewport.y) / viewport.k;
      set({ viewport: { k, x: screenX - worldX * k, y: screenY - worldY * k } });
    },

    /**
     * 适应视图：把**全部可见内容**装进画布。
     *
     * 内容不只是设备卡片 —— 电缆会垂到卡片下方、标签压在线上，
     * 只按卡片算包围盒会把它们切掉。所以这里把每条连线的折线也并进包围盒
     * （折线由 `lib/link-path` 给出，与画布上画的完全同一条）。
     * 缩放与居中的数学在 `lib/fit`（纯函数，有单测）。
     */
    fitView: () => {
      const { world, canvasSize } = get();
      set({
        viewport: computeFit(worldContentBounds(world) ?? { x: 0, y: 0, w: 0, h: 0 }, {
          width: canvasSize.width,
          height: canvasSize.height,
        }),
      });
    },

    /* ── 连线 ── */
    setLinkMode: (on) => set({ linkMode: on, linkDraft: null }),

    cancelLink: () => set({ linkDraft: null }),

    setCableDefaults: (patch) =>
      set((state) => {
        const type = patch.type ?? state.cableDefaults.type;
        // 切换线缆类型时同步一个合理的默认长度：光纤不能只给 10 m，双绞线也不该默认 1 km
        const lengthM =
          patch.lengthM ?? (patch.type ? DEFAULT_LENGTH[patch.type] : state.cableDefaults.lengthM);
        return { cableDefaults: { type, lengthM } };
      }),

    clickPort: (deviceId, portId) => {
      const { linkDraft, cableDefaults, world } = get();

      if (!linkDraft) {
        set({ linkDraft: { deviceId, portId } });
        return;
      }
      if (linkDraft.deviceId === deviceId && linkDraft.portId === portId) {
        set({ linkDraft: null });
        return;
      }
      if (linkDraft.deviceId === deviceId) {
        set({ linkDraft: { deviceId, portId } });
        get().showToast('同一台设备的两个端口之间不能连线，已把起点改为新端口。', 'warn');
        return;
      }

      const devA = world.devices.get(linkDraft.deviceId);
      const devB = world.devices.get(deviceId);
      const portA = devA?.ports.find((p) => p.id === linkDraft.portId);
      const portB = devB?.ports.find((p) => p.id === portId);
      if (!devA || !devB || !portA || !portB) {
        set({ linkDraft: null });
        return;
      }

      const bothWifi = portA.medium === 'wifi' && portB.medium === 'wifi';
      const cableType: CableType = bothWifi ? 'wireless' : cableDefaults.type;
      const lengthM = bothWifi ? 0 : cableDefaults.lengthM;

      // 有线端口已有线缆 → 拒绝（D-11；无线 radio 允许多条关联）
      for (const [device, port] of [
        [devA, portA],
        [devB, portB],
      ] as const) {
        if (port.medium === 'wifi') continue;
        const existing = (world.linksByPort.get(`${device.id}:${port.id}`) ?? []).length;
        if (existing > 0) {
          get().showToast(`${device.name} 的 ${port.name} 已经接了线缆，请先删除原有线缆。`, 'warn');
          set({ linkDraft: null });
          return;
        }
      }

      // 用引擎的协商逻辑做**预检**：画布不允许创建引擎会判为不可用的链路（docs/04-architecture.md §5）
      const candidate: Cable = {
        id: uniqueId('cbl', new Set(get().scenario.cables.map((cable) => cable.id))),
        type: cableType,
        lengthM,
        a: { deviceId: devA.id, portId: portA.id },
        b: { deviceId: devB.id, portId: portB.id },
      };
      const probe = negotiateLink(candidate, devA, portA, devB, portB);
      const error = probe.issues.find((i) => i.level === 'error');

      set({ linkDraft: null });

      if (error) {
        get().showToast(`无法建立链路：${error.text}`, 'error');
        return;
      }

      mutate(
        (draft) => {
          draft.cables.push(candidate);
        },
        { label: `连接 ${devA.name} ↔ ${devB.name}` },
      );
      set({ selection: { devices: [], cables: [candidate.id] } });

      const warning = probe.issues.find((i) => i.level === 'warn');
      if (warning) get().showToast(warning.text, 'warn');
      else {
        get().showToast(
          `已连接 ${devA.name} ${portA.name} ↔ ${devB.name} ${portB.name}，协商速率 ${
            probe.speedMbps >= 1000 ? `${probe.speedMbps / 1000} Gbps` : `${probe.speedMbps} Mbps`
          }。`,
          'info',
        );
      }
    },

    /* ── 拓扑编辑 ── */
    addDevice: (templateKey, x, y) => {
      const template = templateByKey(templateKey);
      if (!template) return;
      const { scenario } = get();
      const sameKind = scenario.devices.filter((d) => d.kind === template.kind).length + 1;
      const id = uniqueId(`dev-${templateKey}`, new Set(scenario.devices.map((d) => d.id)));
      const snap = get().snapEnabled;
      const device = instantiate(
        templateKey,
        id,
        defaultDeviceName(template, sameKind),
        Math.round(snap ? snapToGrid(x) : x),
        Math.round(snap ? snapToGrid(y) : y),
      );
      mutate((draft) => {
        draft.devices.push(device);
      }, { label: `添加 ${device.name}` });
      set({ selection: { devices: [id], cables: [] } });
    },

    moveDevices: (moves, options) =>
      mutatePositions(
        (draft) => {
          const deltas = new Map<string, { dx: number; dy: number }>();
          for (const move of moves) {
            const device = draft.devices.find((d) => d.id === move.deviceId);
            if (!device) continue;
            const nextX = Math.round(move.x);
            const nextY = Math.round(move.y);
            deltas.set(device.id, { dx: nextX - device.x, dy: nextY - device.y });
            device.x = nextX;
            device.y = nextY;
          }

          // 机柜移动时，带着柜内设备一起走
          for (const [id, delta] of deltas) {
            const device = draft.devices.find((d) => d.id === id);
            if (!device?.rack || (delta.dx === 0 && delta.dy === 0)) continue;
            for (const child of draft.devices) {
              if (child.mount?.rackId !== id) continue;
              child.x += delta.dx;
              child.y += delta.dy;
            }
          }

          // 被拖出机柜的设备自动下架（机柜自身移动不算）
          for (const id of deltas.keys()) {
            const device = draft.devices.find((d) => d.id === id);
            if (!device?.mount || device.rack) continue;
            const rack = draft.devices.find((d) => d.id === device.mount?.rackId);
            if (!rack?.rack) {
              device.mount = undefined;
              continue;
            }
            if (!rackContainsPoint(rack, device.x + NODE_W / 2, device.y + NODE_H / 2)) {
              device.mount = undefined;
            }
          }
        },
        { label: options?.label ?? '移动设备', mergeKey: options?.mergeKey ?? 'move' },
      ),

    patchDevice: (deviceId, fn) =>
      mutate(
        (draft) => {
          const device = draft.devices.find((d) => d.id === deviceId);
          if (device) fn(device);
        },
        { label: '修改设备', mergeKey: `device:${deviceId}` },
      ),

    patchPort: (deviceId, portId, patch) =>
      mutate(
        (draft) => {
          const port = draft.devices
            .find((d) => d.id === deviceId)
            ?.ports.find((p) => p.id === portId);
          if (port) Object.assign(port, patch);
        },
        { label: '修改端口', mergeKey: `port:${deviceId}:${portId}` },
      ),

    addPort: (deviceId, spec) => {
      const device = get().world.devices.get(deviceId);
      if (!device) return;
      const medium: PortMedium = spec?.medium ?? 'rj45';
      const name = suggestPortName(device.ports, medium);
      const baseId = portIdFor(name);
      const id = device.ports.some((port) => port.id === baseId)
        ? uniqueId(baseId, new Set(device.ports.map((port) => port.id)))
        : baseId;
      const port: Port = {
        id,
        name,
        medium,
        side: spec?.side ?? 'front',
        speedMbps: spec?.speedMbps ?? defaultPortSpeed(medium),
        duplex: 'full',
        role: spec?.role ?? defaultPortRole(medium),
        vlan: 1,
        module: defaultPortModule(medium),
      };
      mutate(
        (draft) => {
          const target = draft.devices.find((d) => d.id === deviceId);
          if (target) target.ports.push(port);
        },
        { label: `为 ${device.name} 添加端口 ${name}` },
      );
      set({ selection: { devices: [], cables: [], port: { deviceId, portId: id } } });
      get().showToast(`已添加端口 ${name}（${medium}）。`, 'info');
    },

    removePort: (deviceId, portId) => {
      const device = get().world.devices.get(deviceId);
      const port = device?.ports.find((item) => item.id === portId);
      if (!device || !port) return;
      if (device.ports.length <= 1) {
        get().showToast('至少保留一个端口，无法删除最后一个端口。', 'warn');
        return;
      }
      const attached = (get().world.linksByPort.get(`${deviceId}:${portId}`) ?? []).length;
      mutate(
        (draft) => {
          const target = draft.devices.find((d) => d.id === deviceId);
          if (!target) return;
          target.ports = target.ports.filter((item) => item.id !== portId);
          // 端口没了，挂在它上面的三层接口也要清掉，否则会留下悬空引用
          target.l3.interfaces = target.l3.interfaces.filter((itf) => itf.portId !== portId);
          draft.cables = draft.cables.filter(
            (cable) =>
              !(
                (cable.a.deviceId === deviceId && cable.a.portId === portId) ||
                (cable.b.deviceId === deviceId && cable.b.portId === portId)
              ),
          );
        },
        { label: `删除端口 ${port.name}` },
      );
      set({ selection: { devices: [deviceId], cables: [] } });
      get().showToast(
        attached > 0
          ? `已删除端口 ${port.name}，并同时移除了挂在它上面的 ${attached} 条连线。`
          : `已删除端口 ${port.name}。`,
        'info',
      );
    },

    /* ── 机柜 ── */
    mountDevice: (deviceId, rackId, preferredStartU) => {
      const { world } = get();
      const device = world.devices.get(deviceId);
      const rack = world.devices.get(rackId);
      if (!device || !rack?.rack) return;
      if (device.kind === 'rack') return;
      if (!isRackable(device)) {
        get().showToast(`${device.name} 不是机架式设备，无法安装到机柜中。`, 'warn');
        return;
      }
      const units = rackUnitsOf(device);
      const occupied = world.ordered
        .filter((item) => item.mount?.rackId === rackId && item.id !== deviceId)
        .map((item) => ({ startU: item.mount?.startU ?? 1, heightU: rackUnitsOf(item) }));
      const startU = findFreeSlot(rack, occupied, units, preferredStartU);
      if (startU === null) {
        get().showToast(
          `${rack.name} 里没有能容纳 ${units}U 的连续空位了，请提高机柜高度或先下架其他设备。`,
          'warn',
        );
        return;
      }
      mutate(
        (draft) => {
          const target = draft.devices.find((d) => d.id === deviceId);
          const cabinet = draft.devices.find((d) => d.id === rackId);
          if (!target || !cabinet?.rack) return;
          target.mount = { rackId, startU };
          const position = rackMountPosition(cabinet, startU, rackUnitsOf(target));
          target.x = position.x;
          target.y = position.y;
        },
        { label: `上架 ${device.name}` },
      );
      get().showToast(
        `已把 ${device.name}（${units}U）安装到 ${rack.name} 第 ${startU}U。`,
        'info',
      );
    },

    unmountDevice: (deviceId) => {
      const device = get().world.devices.get(deviceId);
      if (!device?.mount) return;
      mutate(
        (draft) => {
          const target = draft.devices.find((d) => d.id === deviceId);
          if (target) target.mount = undefined;
        },
        { label: `下架 ${device.name}` },
      );
      get().showToast(`已把 ${device.name} 从机柜中取出。`, 'info');
    },

    flipRack: (rackId) => {
      // 翻转只是**观察视角**，不是拓扑变更：不记入撤销历史
      mutate(
        (draft) => {
          const rack = draft.devices.find((d) => d.id === rackId);
          if (rack?.rack) rack.rack.flipped = !rack.rack.flipped;
        },
        { label: '翻转机柜', skipHistory: true },
      );
    },

    setDeviceRackUnits: (deviceId, units) => {
      const { world } = get();
      const device = world.devices.get(deviceId);
      if (!device) return;
      const next = Math.min(MAX_RACK_UNITS, Math.max(MIN_RACK_UNITS, Math.round(units)));
      const previous = rackUnitsOf(device);

      // 未上架：只改高度
      if (!device.mount) {
        mutate(
          (draft) => {
            const target = draft.devices.find((d) => d.id === deviceId);
            if (target) target.rackUnits = next;
          },
          { label: `设置 ${device.name} 为 ${next}U`, mergeKey: `units:${deviceId}` },
        );
        return;
      }

      // 已上架：高度变了要重新找一个装得下的位置
      const rack = world.devices.get(device.mount.rackId);
      if (!rack?.rack) return;
      const occupied = world.ordered
        .filter((item) => item.mount?.rackId === rack.id && item.id !== deviceId)
        .map((item) => ({ startU: item.mount?.startU ?? 1, heightU: rackUnitsOf(item) }));
      const slot = findFreeSlot(rack, occupied, next, device.mount.startU);

      mutate(
        (draft) => {
          const target = draft.devices.find((d) => d.id === deviceId);
          const cabinet = draft.devices.find((d) => d.id === rack.id);
          if (!target) return;
          target.rackUnits = next;
          if (!cabinet?.rack) return;
          if (slot === null) {
            // 机柜里放不下新高度：先下架，避免出现"卡片超出柜体"的错位
            target.mount = undefined;
            return;
          }
          target.mount = { rackId: cabinet.id, startU: slot };
          const position = rackMountPosition(cabinet, slot, next);
          target.x = position.x;
          target.y = position.y;
        },
        { label: `设置 ${device.name} 为 ${next}U`, mergeKey: `units:${deviceId}` },
      );

      if (slot === null) {
        get().showToast(
          `${rack.name} 里放不下 ${next}U 的设备，${device.name} 已自动下架。`,
          'warn',
        );
      } else if (next !== previous) {
        get().showToast(`${device.name} 已改为 ${next}U（第 ${slot}U 起）。`, 'info');
      }
    },

    flipDevice: (deviceId) => {
      // 同样是"观察视角"，不记入撤销历史
      mutate(
        (draft) => {
          const device = draft.devices.find((d) => d.id === deviceId);
          if (device) device.flipped = !device.flipped;
        },
        { label: '翻转设备', skipHistory: true },
      );
    },

    setRackHeight: (rackId, heightU) => {
      mutate(
        (draft) => {
          const rack = draft.devices.find((d) => d.id === rackId);
          if (!rack?.rack) return;
          rack.rack.heightU = Math.min(
            MAX_RACK_HEIGHT_U,
            Math.max(MIN_RACK_HEIGHT_U, Math.round(heightU)),
          );
          // 高度变了，重新为柜内设备排位（被挤压出去的自动下架）
          const mounted = draft.devices
            .filter((item) => item.mount?.rackId === rackId)
            .sort((a, b) => (a.mount?.startU ?? 0) - (b.mount?.startU ?? 0));
          const occupied: { startU: number; heightU: number }[] = [];
          for (const item of mounted) {
            const units = rackUnitsOf(item);
            const slot = findFreeSlot(rack, occupied, units, item.mount?.startU);
            if (slot === null) {
              item.mount = undefined;
              continue;
            }
            item.mount = { rackId, startU: slot };
            occupied.push({ startU: slot, heightU: units });
            const position = rackMountPosition(rack, slot, units);
            item.x = position.x;
            item.y = position.y;
          }
        },
        { label: '调整机柜高度' },
      );
    },

    setDeviceWidth: (deviceId, width) =>
      mutate(
        (draft) => {
          const device = draft.devices.find((item) => item.id === deviceId);
          // 上架设备的宽度由机柜决定，改它会造成"卡片比导轨还宽"这种自相矛盾的状态
          if (!device || device.mount) return;
          device.cardWidth = clampCardWidth(width);
        },
        { label: '调整卡片宽度', mergeKey: `width:${deviceId}` },
      ),

    patchCable: (cableId, patch) =>
      mutate(
        (draft) => {
          const cable = draft.cables.find((c) => c.id === cableId);
          if (cable) Object.assign(cable, patch);
        },
        { label: '修改线缆', mergeKey: `cable:${cableId}` },
      ),

    setBonded: (cableId, bonded) =>
      mutate(
        (draft) => {
          const target = draft.cables.find((cable) => cable.id === cableId);
          if (!target) return;
          const pair = [target.a.deviceId, target.b.deviceId].sort().join('→');
          for (const cable of draft.cables) {
            if ([cable.a.deviceId, cable.b.deviceId].sort().join('→') !== pair) continue;
            if (bonded) cable.bonded = true;
            else delete cable.bonded;
          }
        },
        { label: bonded ? '设为链路聚合' : '解除链路聚合' },
      ),

    removeCable: (cableId) => {
      mutate(
        (draft) => {
          draft.cables = draft.cables.filter((cable) => cable.id !== cableId);
        },
        { label: '断开连线' },
      );
      set({ selection: EMPTY_SELECTION });
    },

    deleteSelection: () => {
      const { selection } = get();
      const deviceIds = new Set(selection.devices);
      const cableIds = new Set(selection.cables);
      if (deviceIds.size === 0 && cableIds.size === 0) return;

      mutate(
        (draft) => {
          const removedRacks = new Set(
            draft.devices.filter((d) => deviceIds.has(d.id) && d.rack).map((d) => d.id),
          );
          // 删设备必须连带删线缆，否则留下悬空端点（不变量 1 会被破坏）
          draft.devices = draft.devices.filter((d) => !deviceIds.has(d.id));
          draft.cables = draft.cables.filter(
            (c) =>
              !cableIds.has(c.id) && !deviceIds.has(c.a.deviceId) && !deviceIds.has(c.b.deviceId),
          );
          // 机柜没了，柜内设备就下架（保留在画布上，不跟着消失）
          for (const device of draft.devices) {
            if (device.mount && removedRacks.has(device.mount.rackId)) device.mount = undefined;
          }
        },
        {
          label:
            deviceIds.size > 0
              ? `删除 ${deviceIds.size} 台设备`
              : `删除 ${cableIds.size} 条线缆`,
        },
      );
      set({ selection: EMPTY_SELECTION });
    },

    alignSelection: (mode) => {
      const { selection, scenario } = get();
      const devices = scenario.devices.filter((d) => selection.devices.includes(d.id));
      if (devices.length < 2) {
        get().showToast('对齐至少需要选中 2 台设备（按住 Shift 点选，或在空白处拖出选框）。', 'warn');
        return;
      }
      const positions = alignBoxes(devices.map(deviceBox), mode);
      get().moveDevices(
        devices.map((device, index) => ({
          deviceId: device.id,
          x: positions[index]?.x ?? device.x,
          y: positions[index]?.y ?? device.y,
        })),
        { label: `对齐 ${devices.length} 台设备`, mergeKey: undefined },
      );
    },

    distributeSelection: (axis) => {
      const { selection, scenario } = get();
      const devices = scenario.devices.filter((d) => selection.devices.includes(d.id));
      if (devices.length < 3) {
        get().showToast('等距分布至少需要选中 3 台设备（首尾保持不动，中间项平分间隙）。', 'warn');
        return;
      }
      const positions = distributeBoxes(devices.map(deviceBox), axis);
      get().moveDevices(
        devices.map((device, index) => ({
          deviceId: device.id,
          x: positions[index]?.x ?? device.x,
          y: positions[index]?.y ?? device.y,
        })),
        { label: `等距分布 ${devices.length} 台设备`, mergeKey: undefined },
      );
    },

    /* ── 撤销 / 重做 ── */
    beginHistory: (label) => {
      history.begin(get().scenario, label);
    },

    commitHistory: () => {
      history.commit(get().scenario);
      // 事务期间被推迟的落盘在这里补上（一次拖动只写一次）
      persist(get().scenario);
      set({ history: historyInfo() });
    },

    undo: () => {
      const label = history.undoLabel;
      const restored = history.undo(get().scenario);
      if (!restored) {
        get().showToast('没有可撤销的操作了。', 'warn');
        return;
      }
      persist(restored);
      set({
        scenario: restored,
        world: buildWorld(restored),
        selection: EMPTY_SELECTION,
        linkDraft: null,
        history: historyInfo(),
      });
      get().showToast(`已撤销：${label ?? '操作'}`, 'info');
    },

    redo: () => {
      const label = history.redoLabel;
      const restored = history.redo(get().scenario);
      if (!restored) {
        get().showToast('没有可重做的操作了。', 'warn');
        return;
      }
      persist(restored);
      set({
        scenario: restored,
        world: buildWorld(restored),
        selection: EMPTY_SELECTION,
        linkDraft: null,
        history: historyInfo(),
      });
      get().showToast(`已重做：${label ?? '操作'}`, 'info');
    },

    loadScenario: (scenario) => {
      persist(scenario);
      const world = buildWorld(scenario);
      history.clear();
      set({
        scenario,
        world,
        selection: EMPTY_SELECTION,
        linkDraft: null,
        animation: { token: 0, playing: false, rate: 1 },
        diag: initialDiag(world),
        history: historyInfo(),
      });
      get().fitView();
    },

    /**
     * 载入预置场景。
     *
     * 与 `loadScenario`（导入文件）走同一套"换掉整个世界"的流程，
     * 区别只在于场景来自登记表、并且会给出提示文案。
     */
    loadPreset: (key) => {
      const preset = presetByKey(key);
      if (!preset) {
        get().showToast(`没有名为「${key}」的预置场景。`, 'warn');
        return;
      }
      const scenario = preset.build();
      persist(scenario);
      const world = buildWorld(scenario);
      history.clear();
      set({
        scenario,
        world,
        selection: EMPTY_SELECTION,
        linkDraft: null,
        animation: { token: 0, playing: false, rate: 1 },
        diag: initialDiag(world),
        history: historyInfo(),
      });
      get().fitView();
      get().showToast(`已载入预置场景「${preset.name}」。`, 'info');
    },

    resetScenario: () => {
      get().loadPreset(DEFAULT_PRESET_KEY);
    },

    clearScenario: () => {
      const scenario = buildEmptyScenario();
      persist(scenario);
      const world = buildWorld(scenario);
      history.clear();
      set({
        scenario,
        world,
        selection: EMPTY_SELECTION,
        linkDraft: null,
        animation: { token: 0, playing: false, rate: 1 },
        diag: { ...initialDiag(world), srcId: '' },
        viewport: { x: 60, y: 40, k: 1 },
        history: historyInfo(),
      });
      get().showToast('已清空拓扑。从左侧拖入设备开始绘制。', 'info');
    },

    exportJson: () => JSON.stringify(get().scenario, null, 2),

    importJson: (text) => {
      const parsed = parseScenarioJson(text);
      if (!parsed.ok) return parsed.errors.join('\n');
      get().loadScenario(parsed.scenario);
      get().showToast(`已导入场景「${parsed.scenario.name}」。`, 'info');
      return null;
    },

    /* ── 诊断与动画 ── */
    setDiagSrc: (deviceId) => set((s) => ({ diag: { ...s.diag, srcId: deviceId, result: null } })),
    setDiagDst: (ip) => set((s) => ({ diag: { ...s.diag, dstIp: ip, result: null } })),
    setDnsName: (name) => set((s) => ({ diag: { ...s.diag, dnsName: name, result: null } })),

    runDiag: (kind) => {
      const { world, diag, scenario, animation } = get();
      if (!diag.srcId) {
        get().showToast('请先选择源设备。', 'warn');
        return;
      }

      let result: DiagResult;
      if (kind === 'dns') {
        const name = diag.dnsName.trim();
        if (!name) {
          get().showToast('请先填写要解析的域名。', 'warn');
          return;
        }
        // 缓存是会话状态：复制一份再传入，命中/写入后替换，保证 React 能感知变化
        const cache: DnsSessionCache = new Map(diag.cache);
        result = runDnsPath(world, diag.srcId, name, { cache, nowMs: Date.now() });
        set({
          diag: { ...diag, result, ranOn: scenario.updatedAt, cache },
          animation: nextAnimation(animation, result, kind),
        });
        return;
      }

      const dst = diag.dstIp.trim();
      if (!dst) {
        get().showToast('请先选择或填写目标 IP。', 'warn');
        return;
      }
      result =
        kind === 'ping'
          ? runPing(world, diag.srcId, dst)
          : kind === 'trace'
            ? runPathTrace(world, diag.srcId, dst)
            : runBandwidth(world, diag.srcId, dst);

      set({
        diag: { ...diag, result, ranOn: scenario.updatedAt },
        animation: nextAnimation(animation, result, kind),
      });
    },

    clearDnsCache: () => {
      set((s) => ({ diag: { ...s.diag, cache: new Map(), result: null } }));
      get().showToast('已清空 DNS 缓存，下次解析将走完整链路。', 'info');
    },

    replayFlow: () =>
      set((s) => ({
        animation: { token: s.animation.token + 1, playing: true, rate: s.animation.rate },
      })),

    toggleFlow: () => set((s) => ({ animation: { ...s.animation, playing: !s.animation.playing } })),

    setFlowRate: (rate) => set((s) => ({ animation: { ...s.animation, rate } })),

    showToast: (text, level = 'info') => set({ toast: { text, level } }),
    dismissToast: () => set({ toast: null }),
  };
});

/**
 * 诊断完成后是否启动动画。
 *
 * 有可动画的逐跳路径才播放；且当系统要求"减少动态效果"时不自动播放，
 * 只留给用户手动点播放（NFR-10）。
 */
function nextAnimation(
  current: AnimationState,
  result: DiagResult,
  kind: 'ping' | 'trace' | 'bandwidth' | 'dns',
): AnimationState {
  const animatable = kind !== 'dns' && result.hops.some((hop) => hop.outPortId !== undefined);
  if (!animatable) return { ...current, playing: false };
  return {
    token: current.token + 1,
    playing: !PREFERS_REDUCED_MOTION,
    rate: current.rate,
  };
}
