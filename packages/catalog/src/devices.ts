/**
 * 设备目录
 *
 * 每条目录数据 = 一个可放置的设备模板（默认端口 + 默认服务 + 无线配置）。
 * 新增型号只改本文件，UI 与引擎都不需要改动（docs/03-catalog.md §1）。
 */

import type {
  AccessMode,
  ClientAddressing,
  Device,
  DeviceKind,
  DeviceSubtype,
  DhcpPool,
  DnsServerConfig,
  PortSide,
  RadioCoverage,
  WirelessRadio,
} from '@toposmith/schema';
import { omniCoverage } from '@toposmith/schema';
import { makePorts, type PortSpec } from './ports';
import { SPEED } from './speeds';

export type TemplateGroup =
  | 'access' // 接入与出口
  | 'routing' // 路由交换
  | 'wireless' // 无线
  | 'computer' // 计算机
  | 'mobile' // 可移动设备
  | 'embedded' // 嵌入式设备
  | 'infrastructure'; // 机架与容器

export const TEMPLATE_GROUPS: { id: TemplateGroup; label: string; hint: string }[] = [
  { id: 'access', label: '接入与出口', hint: '光猫 / OLT / 云' },
  { id: 'routing', label: '路由与交换', hint: '路由器 / 交换机' },
  { id: 'wireless', label: '无线', hint: '无线 AP / 4G / 5G 基站 / 5G CPE' },
  { id: 'computer', label: '计算机', hint: '台式 / 笔记本 / 服务器 …' },
  { id: 'mobile', label: '可移动设备', hint: '手机 / 平板' },
  { id: 'embedded', label: '嵌入式设备', hint: 'NAS / 摄像头 / IoT …' },
  { id: 'infrastructure', label: '机架与容器', hint: '机柜（可放入机架式设备）' },
];

export interface DeviceTemplate {
  key: string;
  label: string;
  group: TemplateGroup;
  kind: DeviceKind;
  subtype?: DeviceSubtype;
  model: string;
  /** 画布上的简笔字形（不引入图标库，避免打包体积与版权问题） */
  glyph: string;
  ports: PortSpec[];
  accessMode?: AccessMode;
  services?: Device['services'];
  client?: ClientAddressing;
  wireless?: WirelessRadio;
  note?: string;
  /** 是否为内置扩展设备（用户清单之外，见 DECISIONS D-16） */
  builtinExtension?: boolean;
  /** 可上架设备的 U 高（1 = 1U）；缺省表示不可上架 */
  rackableU?: number;
  /** 仅 kind === 'rack'：机柜默认配置 */
  rack?: { heightU: number };
}

/* ── 端口书写助手，减少目录里的重复 ── */

function rj45(
  name: string,
  speedMbps: number,
  role: PortSpec['role'] = 'access',
  extra: Partial<PortSpec> = {},
): PortSpec {
  return { name, medium: 'rj45', speedMbps, role, vlan: 1, ...extra };
}
function sfp(
  name: string,
  module: string,
  speedMbps: number,
  side: PortSide = 'front',
): PortSpec {
  return { name, medium: 'sfp', speedMbps, role: 'uplink', module, vlan: 1, side };
}
function pon(
  name: string,
  module: string,
  speedMbps: number,
  role: PortSpec['role'],
  side: PortSide = 'front',
): PortSpec {
  return { name, medium: 'pon', speedMbps, role, module, vlan: 1, side };
}
function wlan(role: PortSpec['role'], extra: Partial<PortSpec> = {}): PortSpec {
  return { name: 'WLAN', medium: 'wifi', speedMbps: 0, role, vlan: 1, ...extra };
}

/* ── 无线覆盖的缺省值 ── */

/**
 * 缺省覆盖半径（米）：按设备类型给一个贴近现实的起点（D-56）。
 *
 * 这些数值不是"精确的天线仿真"，而是**行业常识量级**：
 *   家用网关   40 m —— 一台放在客厅的路由器，5 GHz 穿两堵墙大致就是这个量级
 *   无线 AP    30 m —— 商用吸顶 AP 的典型覆盖半径
 *   蜂窝基站  150 m —— 城区微站/小站口径（宏站可达数公里，但画布上没必要）
 * 需要更远就在面板里调大，或者用定向把功率集中到一个方向。
 */
export const DEFAULT_COVERAGE_RADIUS_M: Partial<Record<DeviceKind, number>> = {
  ont: 40,
  router: 40,
  ap: 30,
  'base-station': 150,
};

/** 新建覆盖时的起点：全向 + 该类型的缺省半径 */
export function defaultCoverageFor(kind: DeviceKind): RadioCoverage {
  return omniCoverage(DEFAULT_COVERAGE_RADIUS_M[kind] ?? 30);
}

/** 终端默认走 DHCP（最贴近真实家庭/办公网络） */
const DHCP_CLIENT: ClientAddressing = { mode: 'dhcp', dns: [] };

const HOME_DHCP_POOL: DhcpPool = {
  enabled: true,
  poolStart: '192.168.1.100',
  poolEnd: '192.168.1.200',
  gateway: '192.168.1.1',
  dns: ['192.168.1.1'],
};

const HOME_DNS: DnsServerConfig = {
  enabled: true,
  records: [],
  forwarders: [],
};

export const DEVICE_TEMPLATES: DeviceTemplate[] = [
  /* ── 接入与出口 ── */
  {
    key: 'ont',
    label: '光猫（路由模式）',
    group: 'access',
    kind: 'ont',
    model: '10G-EPON ONU',
    glyph: 'ONT',
    accessMode: 'route',
    ports: [
      pon('PON1', '10G-EPON', SPEED.eth10g, 'wan'),
      rj45('GE1', SPEED.eth1g, 'lan'),
      rj45('GE2', SPEED.eth1g, 'lan'),
      rj45('GE3', SPEED.eth1g, 'lan'),
      rj45('GE4', SPEED.eth1g, 'lan'),
      wlan('lan'),
    ],
    services: { nat: true, dhcp: { ...HOME_DHCP_POOL }, dns: { ...HOME_DNS } },
    wireless: {
      mode: 'ap',
      ssid: 'TopoSmith-Home',
      band: '5G',
      standard: '802.11ax',
      channel: 36,
      coverage: omniCoverage(DEFAULT_COVERAGE_RADIUS_M.ont as number),
    },
    note: '路由模式：自己做 NAT 与 DHCP，是家用最常见形态。',
  },
  {
    key: 'ont-bridge',
    label: '光猫（桥接模式）',
    group: 'access',
    kind: 'ont',
    model: '10G-EPON ONU (Bridge)',
    glyph: 'ONT',
    accessMode: 'bridge',
    ports: [
      pon('PON1', '10G-EPON', SPEED.eth10g, 'wan'),
      rj45('GE1', SPEED.eth1g, 'lan'),
      rj45('GE2', SPEED.eth1g, 'lan'),
      rj45('GE3', SPEED.eth1g, 'lan'),
      rj45('GE4', SPEED.eth1g, 'lan'),
    ],
    services: { nat: false },
    note: '桥接模式：只做光电转换，NAT/DHCP 由下级路由器承担。',
  },
  {
    key: 'olt',
    label: 'OLT 局端',
    group: 'access',
    kind: 'olt',
    model: 'OLT-4P',
    glyph: 'OLT',
    builtinExtension: true,
    // OLT 默认 8U（框式设备）：U 高可在设备卡片里改
    rackableU: 8,
    ports: [
      pon('PON1', '10G-EPON', SPEED.eth10g, 'uplink', 'front'),
      pon('PON2', '10G-EPON', SPEED.eth10g, 'uplink', 'front'),
      // 上联光口在背面：可上架设备的两面都可能有端口
      sfp('SFP1', 'SFP+ 10G', SPEED.eth10g, 'rear'),
    ],
    note: 'PON 是点到多点接入网，没有局端则光猫的 PON 口悬空。正面 PON 口、背面 SFP+ 上联。',
  },
  {
    key: 'cloud',
    label: '云 / 互联网出口',
    group: 'access',
    kind: 'cloud',
    model: 'Internet',
    glyph: 'NET',
    builtinExtension: true,
    ports: [sfp('SFP1', 'SFP+ 10G', SPEED.eth10g)],
    services: { dns: { enabled: true, records: [], forwarders: [] } },
    note: '提供公网侧目标，才能演示 NAT 转换点与 DNS 转发链。',
  },

  /* ── 路由与交换 ── */
  {
    key: 'router',
    label: '路由器',
    group: 'routing',
    kind: 'router',
    model: 'RT-4G',
    glyph: 'RT',
    ports: [
      rj45('GE1', SPEED.eth1g, 'wan', { name: 'WAN1' }),
      rj45('GE2', SPEED.eth1g, 'lan'),
      rj45('GE3', SPEED.eth1g, 'lan'),
      rj45('GE4', SPEED.eth1g, 'lan'),
      sfp('SFP+1', 'SFP+ 10G', SPEED.eth10g),
      wlan('lan'),
    ],
    services: { nat: true, dhcp: { ...HOME_DHCP_POOL }, dns: { ...HOME_DNS } },
    wireless: {
      mode: 'ap',
      ssid: 'TopoSmith-Router',
      band: '5G',
      standard: '802.11ax',
      channel: 44,
      coverage: omniCoverage(DEFAULT_COVERAGE_RADIUS_M.router as number),
    },
  },
  {
    key: 'switch-5-2.5g',
    label: '交换机（5 口 2.5G）',
    group: 'routing',
    kind: 'switch',
    model: 'SW-5×2.5G + 2×SFP+',
    glyph: 'SW',
    rackableU: 4,
    ports: [
      rj45('GE1', SPEED.eth2_5g),
      rj45('GE2', SPEED.eth2_5g),
      rj45('GE3', SPEED.eth2_5g),
      rj45('GE4', SPEED.eth2_5g),
      rj45('GE5', SPEED.eth2_5g),
      sfp('SFP+1', 'SFP+ 10G', SPEED.eth10g),
      sfp('SFP+2', 'SFP+ 10G', SPEED.eth10g),
    ],
    note: '2.5G 端口需要 CAT5e 及以上线缆才能协商到标称速率。',
  },
  {
    key: 'switch-8-1g',
    label: '交换机（8 口千兆）',
    group: 'routing',
    kind: 'switch',
    model: 'SW-8×1G',
    glyph: 'SW',
    rackableU: 4,
    ports: [
      rj45('GE1', SPEED.eth1g),
      rj45('GE2', SPEED.eth1g),
      rj45('GE3', SPEED.eth1g),
      rj45('GE4', SPEED.eth1g),
      rj45('GE5', SPEED.eth1g),
      rj45('GE6', SPEED.eth1g),
      rj45('GE7', SPEED.eth1g),
      rj45('GE8', SPEED.eth1g),
      rj45('MGMT1', SPEED.eth1g, 'lan', { side: 'rear' }),
    ],
  },
  {
    key: 'switch-24-1g',
    label: '交换机（24 口千兆 + 2×SFP+）',
    group: 'routing',
    kind: 'switch',
    model: 'SW-24×1G + 2×SFP+',
    glyph: 'SW',
    rackableU: 4,
    ports: [
      ...Array.from({ length: 24 }, (_, i) => rj45(`GE${i + 1}`, SPEED.eth1g)),
      sfp('SFP+1', 'SFP+ 10G', SPEED.eth10g),
      sfp('SFP+2', 'SFP+ 10G', SPEED.eth10g),
      rj45('MGMT1', SPEED.eth1g, 'lan', { side: 'rear' }),
    ],
  },

  /* ── 无线 ── */
  {
    key: 'ap',
    label: '无线 AP',
    group: 'wireless',
    kind: 'ap',
    model: 'AP-ax3000',
    glyph: 'AP',
    builtinExtension: true,
    ports: [rj45('GE1', SPEED.eth2_5g, 'uplink'), wlan('lan')],
    wireless: {
      mode: 'ap',
      ssid: 'TopoSmith-AP',
      band: '5G',
      standard: '802.11ax',
      channel: 149,
      coverage: omniCoverage(DEFAULT_COVERAGE_RADIUS_M.ap as number),
    },
    note: '无线客户端与 AP 的 LAN 口在二层桥接，属同一广播域；覆盖圈默认 30 m 全向，可拖拽调整。',
  },
  {
    key: 'bs-4g',
    label: '4G 基站（LTE）',
    group: 'wireless',
    kind: 'base-station',
    subtype: 'bs-4g',
    model: 'eNodeB（LTE 微站）',
    glyph: '4G',
    rackableU: 8,
    ports: [
      sfp('SFP+1', 'SFP+ 10G 回传', SPEED.eth10g),
      sfp('SFP+2', 'SFP+ 10G 回传', SPEED.eth10g),
      rj45('GE1', SPEED.eth1g, 'lan', { name: 'GE1（回传/管理）' }),
      wlan('lan'),
    ],
    wireless: {
      mode: 'ap',
      standard: 'lte',
      plmn: '46000',
      coverage: omniCoverage(DEFAULT_COVERAGE_RADIUS_M['base-station'] as number),
    },
    note:
      '基站把无线客户端二层桥接到回传口（回传侧接核心网），二层行为与 AP 一致；' +
      '覆盖默认全向 150 m（城区微站口径）。空口是彻底的共享介质：一个小区内所有终端分同一份带宽。',
  },
  {
    key: 'bs-5g',
    label: '5G 基站（NR）',
    group: 'wireless',
    kind: 'base-station',
    subtype: 'bs-5g',
    model: 'gNodeB（NR 微站）',
    glyph: '5G',
    rackableU: 8,
    ports: [
      sfp('SFP+1', 'SFP+ 25G 回传', SPEED.eth25g),
      sfp('SFP+2', 'SFP+ 25G 回传', SPEED.eth25g),
      rj45('GE1', SPEED.eth1g, 'lan', { name: 'GE1（回传/管理）' }),
      wlan('lan'),
    ],
    wireless: {
      mode: 'ap',
      standard: 'nr',
      plmn: '46000',
      coverage: omniCoverage(DEFAULT_COVERAGE_RADIUS_M['base-station'] as number),
    },
    note:
      '5G 单用户峰值按 NR 中频取 1 Gbps；真实小区里这个数字要所有人分。' +
      '默认全向，城区常用三扇区 —— 把覆盖形状改成「定向 120°」就是一个扇区，' +
      '三台基站朝 0°/120°/240° 就是一套三扇区站。',
  },
  {
    key: 'cpe-5g',
    label: '5G CPE（无线宽带）',
    group: 'wireless',
    kind: 'router',
    model: '5G CPE（NR 转有线）',
    glyph: 'CPE',
    ports: [
      rj45('GE1', SPEED.eth1g, 'lan'),
      rj45('GE2', SPEED.eth1g, 'lan'),
      rj45('GE3', SPEED.eth1g, 'lan'),
      wlan('wan', { name: '5G NR' }),
    ],
    accessMode: 'route',
    services: { nat: true, dhcp: { ...HOME_DHCP_POOL }, dns: { ...HOME_DNS } },
    // 单无线口：蜂窝侧关联基站当上行。室内侧走有线 LAN 口（真实 CPE 也是这么接的）
    wireless: { mode: 'sta', standard: 'nr', plmn: '46000' },
    note:
      '用无线口关联 5G 基站当上行，室内侧用 LAN 口接自己的交换机/AP：' +
      '"没有固网的地方怎么上网"最常见的一种装法（FWA）。',
  },

  /* ── 计算机 ── */
  {
    key: 'pc-desktop',
    label: '台式机',
    group: 'computer',
    kind: 'computer',
    subtype: 'desktop',
    model: 'Desktop PC',
    glyph: 'PC',
    ports: [rj45('GE1', SPEED.eth1g, 'client')],
    client: { ...DHCP_CLIENT },
  },
  {
    key: 'pc-laptop',
    label: '笔记本',
    group: 'computer',
    kind: 'computer',
    subtype: 'laptop',
    model: 'Laptop',
    glyph: 'NB',
    ports: [rj45('GE1', SPEED.eth1g, 'client'), wlan('client')],
    client: { ...DHCP_CLIENT },
    wireless: { mode: 'sta', ssid: 'TopoSmith-Home', band: '5G', standard: '802.11ax' },
  },
  {
    key: 'pc-tablet',
    label: '平板（计算机）',
    group: 'computer',
    kind: 'computer',
    subtype: 'tablet',
    model: 'Tablet PC',
    glyph: 'TB',
    ports: [wlan('client')],
    client: { ...DHCP_CLIENT },
    wireless: { mode: 'sta', ssid: 'TopoSmith-Home', band: '5G', standard: '802.11ax' },
  },
  {
    key: 'server-rack',
    label: '机架式服务器',
    group: 'computer',
    kind: 'computer',
    subtype: 'rack-server',
    model: 'Rack Server 1U',
    glyph: 'SRV',
    rackableU: 4,
    // 服务器的网卡都在背面：翻到机柜背面才能看到并接线
    ports: [
      rj45('GE1', SPEED.eth1g, 'client', { side: 'rear' }),
      rj45('GE2', SPEED.eth1g, 'client', { side: 'rear' }),
      sfp('SFP+1', 'SFP+ 10G', SPEED.eth10g, 'rear'),
      sfp('SFP+2', 'SFP+ 10G', SPEED.eth10g, 'rear'),
    ],
    client: { ...DHCP_CLIENT },
  },
  {
    key: 'workstation-tower',
    label: '塔式工作站',
    group: 'computer',
    kind: 'computer',
    subtype: 'tower-workstation',
    model: 'Tower Workstation',
    glyph: 'WS',
    ports: [rj45('GE1', SPEED.eth1g, 'client'), rj45('GE2', SPEED.eth1g, 'client')],
    client: { ...DHCP_CLIENT },
  },
  {
    key: 'pc-mini',
    label: '迷你主机',
    group: 'computer',
    kind: 'computer',
    subtype: 'mini-pc',
    model: 'Mini PC 2.5G',
    glyph: 'MINI',
    ports: [rj45('2.5GE1', SPEED.eth2_5g, 'client')],
    client: { ...DHCP_CLIENT },
  },

  /* ── 可移动设备 ── */
  {
    key: 'mobile-phone',
    label: '手机',
    group: 'mobile',
    kind: 'mobile',
    subtype: 'phone',
    model: 'Smartphone',
    glyph: 'PH',
    ports: [wlan('client')],
    client: { ...DHCP_CLIENT },
    wireless: { mode: 'sta', ssid: 'TopoSmith-Home', band: '5G', standard: '802.11ax' },
  },
  {
    key: 'mobile-tablet',
    label: '平板（移动）',
    group: 'mobile',
    kind: 'mobile',
    subtype: 'tablet',
    model: 'Tablet',
    glyph: 'TAB',
    ports: [wlan('client')],
    client: { ...DHCP_CLIENT },
    wireless: { mode: 'sta', ssid: 'TopoSmith-Home', band: '5G', standard: '802.11ax' },
  },

  /* ── 嵌入式设备 ── */
  {
    key: 'nas',
    label: 'NAS',
    group: 'embedded',
    kind: 'embedded',
    subtype: 'nas',
    model: 'NAS 2-Bay',
    glyph: 'NAS',
    ports: [rj45('2.5GE1', SPEED.eth2_5g, 'client')],
    client: { ...DHCP_CLIENT },
  },
  {
    key: 'camera',
    label: '网络摄像头',
    group: 'embedded',
    kind: 'embedded',
    subtype: 'camera',
    model: 'IP Camera',
    glyph: 'CAM',
    ports: [rj45('FE1', SPEED.eth100, 'client', { poe: true }), wlan('client')],
    client: { ...DHCP_CLIENT },
    wireless: { mode: 'sta', ssid: 'TopoSmith-Home', band: '2.4G', standard: '802.11n' },
  },
  {
    key: 'printer',
    label: '网络打印机',
    group: 'embedded',
    kind: 'embedded',
    subtype: 'printer',
    model: 'Network Printer',
    glyph: 'PRN',
    ports: [rj45('GE1', SPEED.eth1g, 'client'), wlan('client')],
    client: { ...DHCP_CLIENT },
    wireless: { mode: 'sta', ssid: 'TopoSmith-Home', band: '2.4G', standard: '802.11n' },
  },
  {
    key: 'iot',
    label: 'IoT 传感器',
    group: 'embedded',
    kind: 'embedded',
    subtype: 'iot',
    model: 'IoT Sensor',
    glyph: 'IOT',
    ports: [wlan('client')],
    client: { ...DHCP_CLIENT },
    wireless: { mode: 'sta', ssid: 'TopoSmith-IoT', band: '2.4G', standard: '802.11n' },
  },
  {
    key: 'rack-24u',
    label: '机柜（24U）',
    group: 'infrastructure',
    kind: 'rack',
    model: 'Rack 24U',
    glyph: 'RACK',
    builtinExtension: true,
    ports: [],
    rack: { heightU: 24 },
    note: '容器：把机架式设备（1U）拖进来即可上架；点标题栏的翻转按钮可看背面。',
  },
  {
    key: 'raspberrypi',
    label: '树莓派 / 单板机',
    group: 'embedded',
    kind: 'embedded',
    subtype: 'single-board',
    model: 'Single Board Computer',
    glyph: 'SBC',
    ports: [rj45('GE1', SPEED.eth1g, 'client'), wlan('client')],
    client: { ...DHCP_CLIENT },
    wireless: { mode: 'sta', ssid: 'TopoSmith-Home', band: '5G', standard: '802.11ac' },
  },
];

const BY_KEY = new Map(DEVICE_TEMPLATES.map((t) => [t.key, t]));

export function templateByKey(key: string): DeviceTemplate | undefined {
  return BY_KEY.get(key);
}

/** 设备默认名：中文标签 + 序号（由调用方保证序号不重复） */
export function defaultDeviceName(template: DeviceTemplate, index: number): string {
  return `${template.label}${index > 1 ? ` ${index}` : ''}`;
}

/** 依模板实例化一台设备（不修改模板本身） */
export function instantiate(
  templateKey: string,
  id: string,
  name: string,
  x: number,
  y: number,
): Device {
  const t = templateByKey(templateKey);
  if (!t) throw new Error(`未登记的设备模板：${templateKey}`);
  return {
    id,
    kind: t.kind,
    subtype: t.subtype,
    name,
    model: t.model,
    x,
    y,
    ports: makePorts(t.ports),
    l3: { interfaces: [], staticRoutes: [] },
    services: t.services ? JSON.parse(JSON.stringify(t.services)) : {},
    client: t.client ? JSON.parse(JSON.stringify(t.client)) : undefined,
    // coverage 必须深拷一层：浅拷贝会让所有实例共享同一个覆盖对象，
    // 拖大一台 AP 的覆盖范围会连带改掉所有同型号 AP（D-56 的坑）
    wireless: t.wireless
      ? { ...t.wireless, coverage: t.wireless.coverage ? { ...t.wireless.coverage } : undefined }
      : undefined,
    accessMode: t.accessMode,
    rack: t.rack ? { ...t.rack, flipped: false } : undefined,
    rackUnits: t.rackableU,
  };
}

/** 各分组下的模板，供调色板渲染 */
export function templatesByGroup(group: TemplateGroup): DeviceTemplate[] {
  return DEVICE_TEMPLATES.filter((t) => t.group === group);
}

/** 该模板是否可上架，以及占几个 U */
export function rackableHeightU(templateKey: string): number | undefined {
  return templateByKey(templateKey)?.rackableU;
}

/** 设备是否可上架（按 kind/subtype 判断，供画布拖放校验） */
export function isRackable(device: Device): boolean {
  if (device.kind === 'rack') return false;
  return DEVICE_TEMPLATES.some(
    (template) =>
      template.rackableU !== undefined &&
      template.kind === device.kind &&
      (template.subtype ?? undefined) === (device.subtype ?? undefined),
  );
}
