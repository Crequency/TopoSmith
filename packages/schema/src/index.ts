/**
 * TopoSmith 输入契约（Schema）
 *
 * 这里定义的是**用户能编辑的事实**：设备、端口、线缆、配置。
 * 派生产物（链路协商结果、地址分配、广播域、诊断结果）不在本文件里，
 * 它们由推演内核 Anvil（`@toposmith/anvil`）每次推演重算 —— 见 docs/02-domain-model.md §1。
 */

import { SCHEMA_VERSION } from './version';

/** 场景结构版本；仅在破坏性变更时 +1，并必须补迁移函数与迁移测试 */
export { SCHEMA_VERSION } from './version';

/** 导入校验（validateScenario / parseScenarioJson） */
export * from './validate';

/* ────────────────────────────── 设备 ────────────────────────────── */

export type DeviceKind =
  | 'ont' // 光猫（ONU）
  | 'router' // 路由器
  | 'switch' // 交换机
  | 'computer' // 计算机（固定办公）
  | 'mobile' // 可移动设备（随身）
  | 'embedded' // 嵌入式设备
  | 'ap' // 无线接入点（内置扩展）
  | 'base-station' // 蜂窝基站（4G / 5G）
  | 'olt' // 局端 OLT（内置扩展）
  | 'cloud' // 云 / 互联网出口（内置扩展）
  | 'rack'; // 机柜容器（不是网络设备，只承载机架式设备）

export type ComputerSubtype =
  | 'desktop'
  | 'laptop'
  | 'tablet'
  | 'rack-server'
  | 'tower-workstation'
  | 'mini-pc';

export type MobileSubtype = 'phone' | 'tablet';

export type EmbeddedSubtype = 'nas' | 'camera' | 'printer' | 'iot' | 'single-board';

export type BaseStationSubtype = 'bs-4g' | 'bs-5g';

export type DeviceSubtype =
  | ComputerSubtype
  | MobileSubtype
  | EmbeddedSubtype
  | BaseStationSubtype;

/** 设备在真实网络里的行为，由 kind 决定（docs/02-domain-model.md §2.1） */
export interface DeviceBehavior {
  /** 是否做二层转发（广播域的传播者：交换机、AP） */
  l2Forwarding: boolean;
  /** 是否做三层转发（广播域的终结者：路由器、光猫、OLT、云） */
  l3Forwarding: boolean;
}

export const DEVICE_BEHAVIOR: Record<DeviceKind, DeviceBehavior> = {
  switch: { l2Forwarding: true, l3Forwarding: false },
  ap: { l2Forwarding: true, l3Forwarding: false },
  // 基站把无线客户端桥接到回程端口，二层行为与 AP 一致
  'base-station': { l2Forwarding: true, l3Forwarding: false },
  router: { l2Forwarding: false, l3Forwarding: true },
  ont: { l2Forwarding: false, l3Forwarding: true },
  olt: { l2Forwarding: false, l3Forwarding: true },
  cloud: { l2Forwarding: false, l3Forwarding: true },
  computer: { l2Forwarding: false, l3Forwarding: false },
  mobile: { l2Forwarding: false, l3Forwarding: false },
  embedded: { l2Forwarding: false, l3Forwarding: false },
  // 机柜是容器：不转发、也不终结广播域，只是画布上的一个承载物
  rack: { l2Forwarding: false, l3Forwarding: false },
};

export const DEVICE_KIND_LABEL: Record<DeviceKind, string> = {
  ont: '光猫',
  router: '路由器',
  switch: '交换机',
  computer: '计算机',
  mobile: '可移动设备',
  embedded: '嵌入式设备',
  ap: '无线 AP',
  'base-station': '蜂窝基站',
  olt: 'OLT 局端',
  cloud: '云 / 互联网',
  rack: '机柜',
};

export const DEVICE_SUBTYPE_LABEL: Record<DeviceSubtype, string> = {
  desktop: '台式机',
  laptop: '笔记本',
  tablet: '平板（计算机）',
  'rack-server': '机架式服务器',
  'tower-workstation': '塔式工作站',
  'mini-pc': '迷你主机',
  phone: '手机',
  nas: 'NAS',
  camera: '网络摄像头',
  printer: '网络打印机',
  iot: 'IoT 传感器',
  'single-board': '树莓派 / 单板机',
  'bs-4g': '4G 基站',
  'bs-5g': '5G 基站',
};

/* ────────────────────────────── 端口 ────────────────────────────── */

export type PortMedium =
  | 'rj45' // 电口
  | 'sfp' // 光模块口（含 SFP/SFP+/SFP28）
  | 'pon' // PON 口
  | 'wifi'; // 无线

export type Duplex = 'full' | 'half';

export type PortRole =
  | 'lan'
  | 'wan'
  | 'access'
  | 'trunk'
  | 'uplink'
  | 'client';

export const PORT_MEDIUM_LABEL: Record<PortMedium, string> = {
  rj45: 'RJ45 电口',
  sfp: 'SFP 光口',
  pon: 'PON 口',
  wifi: '无线',
};

/** 端口所在的面：机架式设备的两面都可能有端口，具体视设备而定 */
export type PortSide = 'front' | 'rear';

export interface Port {
  id: string;
  /** 端口名，如 GE1 / Gi1/0/1 / SFP+1 / PON1 / WLAN */
  name: string;
  /** 端口在设备的哪一面；缺省视为正面 */
  side?: PortSide;
  medium: PortMedium;
  /** 标称速率（Mbps）；无线端口为 0，实际速率由无线协商决定 */
  speedMbps: number;
  duplex: Duplex;
  role: PortRole;
  /** access / lan / wan 口的 PVID，默认 1 */
  vlan?: number;
  /** trunk 口允许通过的 VLAN 列表 */
  allowedVlans?: number[];
  /** SFP 口插入的模块，如 'SFP+ 10G' */
  module?: string;
  /** 供电（仅展示用，M0 不参与计算） */
  poe?: boolean;
}

/* ────────────────────────────── 线缆 ────────────────────────────── */

export type CableType =
  | 'cat5'
  | 'cat5e'
  | 'cat6'
  | 'cat6a'
  | 'lc-om3'
  | 'lc-om4'
  | 'lc-sm'
  | 'dac'
  | 'wireless';

export interface Endpoint {
  deviceId: string;
  portId: string;
}

export interface Cable {
  id: string;
  type: CableType;
  /** 长度（米）；无线关联无长度概念，固定 0 */
  lengthM: number;
  a: Endpoint;
  b: Endpoint;
  /**
   * 速率标签在连线上的位置：**弧长比例**，0 = A 端端口，1 = B 端端口；
   * 缺省 `DEFAULT_LABEL_RATIO`（中点）。
   *
   * 存比例而不是像素坐标：缩放画布、拖动设备、改端口布局之后，标签仍贴在那条连线的
   * 同一相对位置上，不会自己飘走（FR-46 / D-36）。这是**纯展示属性**，
   * 不参与任何推演 —— 挪标签不会改变诊断结论。
   */
  labelRatio?: number;
  /**
   * 是否与**同对端之间的其他 `bonded` 线缆**组成一条链路聚合（LACP / 静态聚合）。
   *
   * 语义是"与对端之间的聚合组"，没有额外的组 id：同一对设备之间所有 `bonded` 的
   * 线缆就是同一组，同一组在多条时视为**一条逻辑链路**（带宽是叠加的问题另说，
   * 但**拓扑上不再成环**）。这是"双上行"与"插错一根多余的线"的分水岭：
   * 做了聚合 = 冗余带宽，没做聚合 = 二层环路 + 广播风暴（FR-66 / D-50）。
   *
   * 之所以不带组 id：组身份由"两端设备"唯一确定，UI 上一个勾选框就能表达，
   * 也不会出现"组里只剩一根成员"的悬空状态。
   */
  bonded?: boolean;
}

/** 标签默认落在连线弧长中点 */
export const DEFAULT_LABEL_RATIO = 0.5;

/** 允许范围：两端各留余量，避免标签被端口图元压住或跑出线外 */
export const MIN_LABEL_RATIO = 0.04;
export const MAX_LABEL_RATIO = 0.96;

/** 把任意输入钳制到合法的标签位置（含缺省值与非数字兜底） */
export function clampLabelRatio(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LABEL_RATIO;
  return Math.max(MIN_LABEL_RATIO, Math.min(MAX_LABEL_RATIO, value));
}

/* ────────────────────────────── 二层 / 三层配置 ────────────────────────────── */

export interface L3Interface {
  id: string;
  portId: string;
  ip: string;
  /** 前缀长度 0–32 */
  prefix: number;
  /** 该接口所属 VLAN（用于 VLAN 子接口场景，M1 起使用） */
  vlan?: number;
}

export interface StaticRoute {
  id: string;
  dst: string;
  prefix: number;
  nextHop: string;
}

/* ────────────────────────────── 服务 ────────────────────────────── */

export interface DhcpPool {
  enabled: boolean;
  poolStart: string;
  poolEnd: string;
  gateway: string;
  /** 下发给客户端的 DNS 服务器列表 */
  dns: string[];
}

export interface DnsRecord {
  id: string;
  name: string;
  ip: string;
}

export interface DnsServerConfig {
  enabled: boolean;
  /** 本机静态 / 权威记录 */
  records: DnsRecord[];
  /** 上游 DNS（转发器），按顺序尝试 */
  forwarders: string[];
}

/* ────────────────────────────── 终端地址配置 ────────────────────────────── */

export interface ClientAddressing {
  mode: 'static' | 'dhcp';
  ip?: string;
  prefix?: number;
  gateway?: string;
  dns: string[];
}

/* ────────────────────────────── 无线 ────────────────────────────── */

export type WifiBand = '2.4G' | '5G' | '6G';
export type WifiStandard = '802.11n' | '802.11ac' | '802.11ax' | '802.11be';

/** 蜂窝标准：LTE（4G）与 NR（5G） */
export type CellularStandard = 'lte' | 'nr';

/** 无线制式：WiFi 各代 + 蜂窝两代。速率协商按"两端能力取小"，与介质无关 */
export type RadioStandard = WifiStandard | CellularStandard;

export function isCellularStandard(standard?: RadioStandard): standard is CellularStandard {
  return standard === 'lte' || standard === 'nr';
}

/**
 * 覆盖形状：**全向**（以设备为圆心的圆）与**定向**（扇形）。
 *
 * 半径用**米**（物理事实，与线缆长度同一套单位），画布按固定比例绘制：
 * `1 米 = 20 世界单位`（见下方 `WORLD_UNITS_PER_METER` 与 D-56）。
 * 扇形用「朝向 + 开合角度」描述：朝向 0° 指向 +X（画布右方），顺时针为正
 * （画布 Y 轴向下，与 atan2(dy, dx) 的自然方向一致）。
 */
export type CoverageShape = 'omni' | 'sector';

export interface RadioCoverage {
  shape: CoverageShape;
  /** 覆盖半径（米） */
  radiusM: number;
  /** 扇形开合角度（度），仅 `shape === 'sector'` 有意义 */
  angleDeg?: number;
  /** 扇形朝向（度），仅 `shape === 'sector'` 有意义 */
  azimuthDeg?: number;
  /**
   * 是否参与覆盖判定与绘制（缺省 true）。
   * 关掉表示"这台设备我不关心覆盖范围"：既不判定、也不画，
   * 其无线关联退回旧版行为（不做覆盖校验）。
   */
  enabled?: boolean;
}

export const MIN_COVERAGE_RADIUS_M = 1;
export const MAX_COVERAGE_RADIUS_M = 5000;
export const MIN_SECTOR_ANGLE_DEG = 5;
export const MAX_SECTOR_ANGLE_DEG = 360;

export function clampCoverageRadius(radiusM: number): number {
  if (!Number.isFinite(radiusM)) return MIN_COVERAGE_RADIUS_M;
  return Math.max(MIN_COVERAGE_RADIUS_M, Math.min(MAX_COVERAGE_RADIUS_M, radiusM));
}

export function clampSectorAngle(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) return 90;
  return Math.max(MIN_SECTOR_ANGLE_DEG, Math.min(MAX_SECTOR_ANGLE_DEG, angleDeg));
}

/* ──────────────────────── 画布比例与覆盖几何 ──────────────────────── */

/**
 * 画布比例：**1 米 = 20 世界单位**（1 世界单位 = 5 厘米）。
 *
 * 这个常数只服务于**无线覆盖**：半径是物理量（米），画布是示意图，
 * 两者之间必须有且只有一个换算系数，否则"画出来的圈"与"判定用的圈"会不一致。
 *
 * 取 20 而不是 1 或 100 的理由（D-56）：预置场景里现有的无线关联距离落在
 * 250–720 世界单位，按 20 u/m 折算是 12.5–36 米 —— 室内 AP 与终端的合理距离；
 * 于是"室内 AP 覆盖 30 米、家用网关 40 米"这类真实取值不用改布局就能成立。
 *
 * 有线线缆**不参与**这个换算：线缆长度是用户声明的物理事实（`Cable.lengthM`），
 * 与画布上画多长无关（画布不是等比图纸，见 docs/05-engine.md §6）。
 */
export const WORLD_UNITS_PER_METER = 20;

export function metersToWorld(meters: number): number {
  return meters * WORLD_UNITS_PER_METER;
}

export function worldToMeters(units: number): number {
  return units / WORLD_UNITS_PER_METER;
}

/** 覆盖几何的规范形态：两个形状共用一套字段，缺省值在构造时补齐 */
export interface CoverageGeometry {
  shape: CoverageShape;
  radiusM: number;
  radiusWorld: number;
  /** 扇形开合角度；全向恒为 360 */
  angleDeg: number;
  /** 扇形朝向；全向恒为 0（无意义） */
  azimuthDeg: number;
}

export function omniCoverage(radiusM: number): RadioCoverage {
  return { shape: 'omni', radiusM: clampCoverageRadius(radiusM) };
}

export function sectorCoverage(
  radiusM: number,
  angleDeg: number,
  azimuthDeg = 0,
): RadioCoverage {
  return {
    shape: 'sector',
    radiusM: clampCoverageRadius(radiusM),
    angleDeg: clampSectorAngle(angleDeg),
    azimuthDeg: normalizeAzimuth(azimuthDeg),
  };
}

/** 把（可能缺字段的）输入规范化成几何计算用的完整形态 */
export function coverageGeometry(coverage: RadioCoverage): CoverageGeometry {
  const sector = coverage.shape === 'sector';
  const radiusM = clampCoverageRadius(coverage.radiusM);
  return {
    shape: coverage.shape,
    radiusM,
    radiusWorld: metersToWorld(radiusM),
    angleDeg: sector ? clampSectorAngle(coverage.angleDeg ?? 90) : 360,
    azimuthDeg: normalizeAzimuth(coverage.azimuthDeg ?? 0),
  };
}

/** 覆盖是否启用（缺省启用） */
export function coverageEnabled(coverage?: RadioCoverage): boolean {
  return coverage !== undefined && coverage.enabled !== false;
}

/** 两点间的世界距离换算成米（覆盖判定的距离口径） */
export function distanceMeters(a: Point, b: Point): number {
  return worldToMeters(Math.hypot(b.x - a.x, b.y - a.y));
}

/** 从 origin 看向 point 的方位角（度，0° = +X，顺时针为正） */
export function bearingDeg(origin: Point, point: Point): number {
  return normalizeAzimuth((Math.atan2(point.y - origin.y, point.x - origin.x) * 180) / Math.PI);
}

/** 两个方位角之间的最小夹角（0–180 度） */
export function angleDeltaDeg(a: number, b: number): number {
  return Math.abs(((normalizeAzimuth(a) - normalizeAzimuth(b) + 540) % 360) - 180);
}

/**
 * 点是否落在覆盖区域内。
 *
 * 判定口径（D-57）：以**覆盖提供方**（`mode === 'ap'` 且有覆盖的那一端）
 * 的设备中心为原点，距离按 `WORLD_UNITS_PER_METER` 换算成米与半径比较；
 * 扇形再要求方位角落在 `[azimuth - angle/2, azimuth + angle/2]` 内。
 *
 * 这是一个**纯几何**判定：没有墙、没有衰落、没有天线增益。
 * 室内穿墙、5G 毫米波被遮挡这类物理效应一律不建模（见 docs/05-engine.md §6）。
 */
export function coverageContains(
  coverage: RadioCoverage,
  origin: Point,
  point: Point,
): boolean {
  const geo = coverageGeometry(coverage);
  if (Math.hypot(point.x - origin.x, point.y - origin.y) > geo.radiusWorld) return false;
  if (geo.shape === 'omni') return true;
  return angleDeltaDeg(bearingDeg(origin, point), geo.azimuthDeg) <= geo.angleDeg / 2;
}

/**
 * 点距离覆盖区域的**最近边缘**还有多远（米）。
 *
 * 覆盖内返回 0（带符号的余量另有 `coverageMarginM`）；覆盖外返回正数，
 * 用于回答用户最关心的那个问题："还差几米才算进去"。
 */
export function coverageDistanceOutsideM(
  coverage: RadioCoverage,
  origin: Point,
  point: Point,
): number {
  const geo = coverageGeometry(coverage);
  const distanceWorld = Math.hypot(point.x - origin.x, point.y - origin.y);
  if (distanceWorld > geo.radiusWorld) return worldToMeters(distanceWorld - geo.radiusWorld);
  if (geo.shape === 'omni') return 0;
  // 在半径内但在扇形之外：给出"转过去还差多少度"，换算成半径处的弧长（米）
  const delta = angleDeltaDeg(bearingDeg(origin, point), geo.azimuthDeg) - geo.angleDeg / 2;
  if (delta <= 0) return 0;
  return worldToMeters(((delta * Math.PI) / 180) * distanceWorld);
}

/**
 * 覆盖余量（米）：正数表示在覆盖内且离边缘还有多远，负数表示还差多远进不去。
 * 取距离余量与角度余量中更紧的一个。
 */
export function coverageMarginM(coverage: RadioCoverage, origin: Point, point: Point): number {
  const geo = coverageGeometry(coverage);
  const distanceWorld = Math.hypot(point.x - origin.x, point.y - origin.y);
  const byDistance = worldToMeters(geo.radiusWorld - distanceWorld);
  if (geo.shape === 'omni') return byDistance;
  const delta = geo.angleDeg / 2 - angleDeltaDeg(bearingDeg(origin, point), geo.azimuthDeg);
  const byAngle = worldToMeters(((delta * Math.PI) / 180) * Math.max(distanceWorld, 1));
  return Math.min(byDistance, byAngle);
}

/* ──────────────────────── 卡片足迹（画布几何契约） ──────────────────────── */

/**
 * 卡片足迹：一台设备在画布上占多大。
 *
 * 放在 schema 而不是 web 里的原因很具体：**覆盖判定的原点是设备卡片的中心**，
 * 而"中心在哪"由卡片尺寸决定。引擎要判、画布要画，两边必须用同一份足迹 ——
 * 否则会出现"看着在圈里、判定说在圈外"这种最难查的不一致（D-56）。
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

/** 设备卡片尺寸（世界坐标） */
export const NODE_W = 152;
export const NODE_H = 86;

/** 卡片宽度可调范围（FR-49） */
export const MIN_CARD_W = 120;
export const MAX_CARD_W = 420;

export function clampCardWidth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return NODE_W;
  return Math.round(Math.min(MAX_CARD_W, Math.max(MIN_CARD_W, value)));
}

/**
 * 每 U 的高度：取 (NODE_H + 6) / 4 —— 一张标准卡片在视觉上等于 4U。
 * 真实 19″ 机架的宽高比 482.6 / 44.45 ≈ 10.86，由 U 高反推设备宽度。
 */
const RACK_UNIT_H_RAW = (NODE_H + 6) / 4;
export const RACK_UNIT_H = Math.round(RACK_UNIT_H_RAW);
export const RACK_ASPECT = 482.6 / 44.45;
export const RACK_EQUIPMENT_W = Math.round(RACK_UNIT_H_RAW * RACK_ASPECT);

export const DEFAULT_RACK_UNITS = 4;
export const MIN_RACK_UNITS = DEFAULT_RACK_UNITS;
export const MAX_RACK_UNITS = 24;

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
 * 上架后跟随机柜的设备面板宽度（19 英寸设备宽度）；未上架时用 `device.cardWidth`，
 * 缺省为标准卡片宽度。上架设备不参与宽度调整。
 */
export function cardWidthOf(device: CardSized): number {
  if (device.mount) return RACK_EQUIPMENT_W;
  return device.cardWidth === undefined ? NODE_W : clampCardWidth(device.cardWidth);
}

export function deviceRect(device: CardSized & Point): Box {
  return { x: device.x, y: device.y, w: cardWidthOf(device), h: cardHeightOf(device) };
}

/**
 * 设备卡片中心（世界坐标）。
 *
 * 覆盖圆的圆心、信号波动画的起点、流向动画的锚点都用它 ——
 * 一处定义，三处一致。
 */
export function deviceCenter(device: CardSized & Point): Point {
  const rect = deviceRect(device);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** 机柜的 U 位几何（渲染与"拖放上架"共用） */
export interface RackLike {
  x: number;
  y: number;
  rack?: { heightU: number; flipped: boolean };
}

export function rackHeightU(rack: RackLike): number {
  return Math.max(1, Math.round(rack.rack?.heightU ?? 12));
}

/** 朝向规范化到 [0, 360) */
export function normalizeAzimuth(azimuthDeg: number): number {
  if (!Number.isFinite(azimuthDeg)) return 0;
  return ((azimuthDeg % 360) + 360) % 360;
}

export interface WirelessRadio {
  mode: 'ap' | 'sta';
  ssid?: string;
  band?: WifiBand;
  /** 制式：WiFi 各代（2.4G/5G/6G 用 `band`）或蜂窝（`lte` / `nr`，不用 `band`） */
  standard?: RadioStandard;
  channel?: number;
  /**
   * 仅蜂窝：网络标识（PLMN，形如 `46000`）。
   *
   * WiFi 靠 SSID 判断"是不是同一个网络"，蜂窝靠 PLMN + 制式。
   * 两端都填了且不一致 → 关联不成立（终端不会注册到别人的网络）；
   * 终端留空表示"任意网络都行"（例如国外漫游卡）。
   */
  plmn?: string;
  /**
   * 覆盖区域：只有**提供覆盖**的一端（`mode === 'ap'`：AP、家用网关的无线、基站）才有。
   * 关联是否成立由引擎按几何判定（超出覆盖＝不成立，见 D-57）。
   */
  coverage?: RadioCoverage;
}

/* ────────────────────────────── 设备 ────────────────────────────── */

/** 光猫 / 路由器的工作模式：桥接时不做 NAT 与 DHCP，仅透传 */
export type AccessMode = 'bridge' | 'route';

/** 机柜容器配置 */
export interface RackConfig {
  /** 机柜高度（U 数） */
  heightU: number;
  /** 是否翻到背面观察 */
  flipped: boolean;
}

/** 机架式设备在机柜中的挂载关系 */
export interface RackMount {
  rackId: string;
  /** 起始 U 位（从机柜顶部往下数，从 1 开始） */
  startU: number;
}

export interface Device {
  id: string;
  kind: DeviceKind;
  subtype?: DeviceSubtype;
  name: string;
  /** 型号文本，仅展示 */
  model?: string;
  x: number;
  y: number;
  ports: Port[];
  l3: {
    interfaces: L3Interface[];
    staticRoutes: StaticRoute[];
    /** 默认网关（默认路由的下一跳） */
    defaultGateway?: string;
  };
  services: {
    dhcp?: DhcpPool;
    dns?: DnsServerConfig;
    /** 是否启用源地址转换（NAT/SNAT） */
    nat?: boolean;
  };
  /** 终端类设备的地址获取方式 */
  client?: ClientAddressing;
  wireless?: WirelessRadio;
  accessMode?: AccessMode;
  /** 仅 kind === 'rack'：机柜配置 */
  rack?: RackConfig;
  /**
   * 机架式设备占用的 U 高（1–8）。
   * 一个设备不等于 1U —— 2U 交换机、4U 存储都很常见，卡片的实际高度按它计算。
   */
  rackUnits?: number;
  /**
   * 未上架设备的**自定义卡片宽度**（世界坐标，`MIN_CARD_W`–`MAX_CARD_W`）。
   * 缺省为 `NODE_W`；上架设备的宽度由机柜决定，此字段不生效（FR-49）。
   */
  cardWidth?: number;
  /**
   * 未上架设备自身的观察面（true = 看背面）。
   * 上架设备的观察面跟随机柜 —— 翻转机柜在物理上就是翻转柜内所有设备。
   */
  flipped?: boolean;
  /** 仅机架式设备：被放进某个机柜 */
  mount?: RackMount;
  /** 用户备注 */
  notes?: string;
}

/* ────────────────────────────── 场景 ────────────────────────────── */

export interface Scenario {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  devices: Device[];
  cables: Cable[];
  /** ISO 时间戳；仅用于展示与文件比对，不参与推演 */
  updatedAt: string;
}

/** 供 UI 与引擎共享的便捷查询：该设备是否有三层能力 */
export function isL3Device(kind: DeviceKind): boolean {
  return DEVICE_BEHAVIOR[kind].l3Forwarding;
}

/** 该设备是否传播广播域 */
export function isL2Device(kind: DeviceKind): boolean {
  return DEVICE_BEHAVIOR[kind].l2Forwarding;
}

/** 终端类设备（不转发任何东西，只收发） */
export function isEndHost(kind: DeviceKind): boolean {
  return !DEVICE_BEHAVIOR[kind].l2Forwarding && !DEVICE_BEHAVIOR[kind].l3Forwarding;
}
