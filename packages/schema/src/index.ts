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

export type DeviceSubtype = ComputerSubtype | MobileSubtype | EmbeddedSubtype;

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

export interface WirelessRadio {
  mode: 'ap' | 'sta';
  ssid?: string;
  band?: WifiBand;
  standard?: WifiStandard;
  channel?: number;
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
