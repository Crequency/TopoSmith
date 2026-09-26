/**
 * 预置场景：无线连接动画总览（九种表现形式同屏）
 *
 * 这个场景是**给动画看的**：九个小区各放一台提供接入的设备，每台**单独指定**一种动画
 * （`wireless.animation`，FR-86），于是打开就能一次看全九种形态 ——
 * 信号波（默认）、信号涟漪、波束扫描、数据流光点、连接线、蜂窝网格、电磁波、
 * Massive MIMO 波束、脉冲闪烁。
 *
 * 三个刻意的设计：
 *  1. **设备名就是图例**：每台设备叫「AP-1 信号涟漪」这样，卡片上直接写明这一格是什么形态，
 *     不需要额外的说明面板；
 *  2. **九台设备各自带覆盖圈**，且终端都在圈内 —— 动画只对"关联成立"的链路绘制，
 *     所以每一格的终端位置都按半径算过（约 17–23 m，半径 22–80 m）；
 *  3. **形态与频段搭配**：电磁波放在 6 GHz（频点最高、波长最短 → 波最密，正好体现
 *     "频率越高波越密"），蜂窝网格与 Massive MIMO 放在 5G 基站上（这两件事本来就是蜂窝的）；
 *  4. **九宫格 + 光猫无线关闭**：九台设备按 3×3 摆开（间距 1150 世界单位），公网/汇聚三台居中摆在
 *     正上方；光猫自带的无线**显式关掉**，否则它是第 10 个"没有动画的提供方"，
 *     会多画一个覆盖圈、破坏"九格一形态"的对照关系（详见下面的注释）。
 *
 * 另外这一屏还顺便演示**两层设置**：默认（遵照每台设备）下九种同时在场；
 * 打开用户设置切到「统一动画」，九格会立刻变成同一种 —— 这正是那个开关的意义。
 *
 * 地址规划（真实可推演，不是只有动画）：
 *   公网    203.0.113.0/24   云 .1（兼权威 DNS）、光猫 WAN .10
 *   家庭段  192.168.50.0/24  光猫 .1（NAT + DHCP + DNS 转发）、交换机 .2、九台无线设备 .11–.19
 *   终端    192.168.50.100+  由光猫分配
 */

import { instantiate } from '@toposmith/catalog';
import {
  SCHEMA_VERSION,
  omniCoverage,
  type Cable,
  type Device,
  type DeviceSubtype,
  type Scenario,
  type WifiBand,
  type WifiStandard,
  type WirelessAnimationStyle,
} from '@toposmith/schema';

/** 一格的配方：形态、设备模板、名字、半径、频段/制式/信道、SSID、终端 */
interface Cell {
  animation: WirelessAnimationStyle;
  /** 提供接入的设备模板 */
  template: string;
  label: string;
  /** 覆盖半径（米）：终端都放在圈内约 17–23 m 处 */
  radiusM: number;
  x: number;
  y: number;
  /** WiFi 专用 */
  ssid?: string;
  band?: WifiBand;
  standard?: WifiStandard;
  channel?: number;
  /** 蜂窝专用 */
  plmn?: string;
  /** 对端（终端）配方：模板、名字、相对提供方的偏移 */
  peers: { template: string; label: string; dx: number; dy: number; subtype?: DeviceSubtype }[];
  /** 该格的静态管理地址（192.168.50.x） */
  host: number;
}

/** 九格：顺序与用户给的对照表一致（默认信号波排第一） */
const CELLS: Cell[] = [
  {
    animation: 'waves',
    template: 'ap',
    label: 'AP-1 信号波',
    radiusM: 22,
    x: 300,
    y: 800,
    ssid: 'Showcase-Waves',
    band: '5G',
    standard: '802.11ax',
    channel: 44,
    host: 11,
    peers: [{ template: 'pc-laptop', label: '笔记本（信号波）', dx: 320, dy: 150 }],
  },
  {
    animation: 'ripple',
    template: 'ap',
    label: 'AP-2 信号涟漪',
    radiusM: 32,
    x: 1450,
    y: 800,
    ssid: 'Showcase-Ripple',
    band: '5G',
    standard: '802.11ax',
    channel: 36,
    host: 12,
    peers: [{ template: 'mobile-phone', label: '手机（涟漪）', dx: 330, dy: 170 }],
  },
  {
    animation: 'beam',
    template: 'ap',
    label: 'AP-3 波束扫描',
    radiusM: 26,
    x: 2600,
    y: 800,
    ssid: 'Showcase-Beam',
    band: '5G',
    standard: '802.11ax',
    channel: 48,
    host: 13,
    peers: [{ template: 'pc-tablet', label: '平板（波束扫描）', dx: 330, dy: 160 }],
  },
  {
    animation: 'stream',
    template: 'ap',
    label: 'AP-4 数据流光点',
    radiusM: 22,
    x: 300,
    y: 1750,
    ssid: 'Showcase-Stream',
    band: '5G',
    standard: '802.11ac',
    channel: 149,
    host: 14,
    peers: [{ template: 'pc-laptop', label: '笔记本（数据流）', dx: 330, dy: 150 }],
  },
  {
    animation: 'line',
    template: 'ap',
    label: 'AP-5 连接线',
    radiusM: 24,
    x: 1450,
    y: 1750,
    ssid: 'Showcase-Line',
    band: '2.4G',
    standard: '802.11n',
    channel: 6,
    host: 15,
    peers: [{ template: 'iot', label: 'IoT（连接线）', dx: 320, dy: 160 }],
  },
  {
    animation: 'cell',
    template: 'bs-5g',
    label: '5G 基站 A 蜂窝网格',
    radiusM: 60,
    x: 2600,
    y: 1750,
    plmn: '46000',
    host: 16,
    peers: [{ template: 'mobile-phone', label: '手机（蜂窝网格）', dx: 400, dy: 200 }],
  },
  {
    animation: 'em',
    template: 'ap',
    label: 'AP-6 电磁波（6 GHz）',
    radiusM: 22,
    x: 300,
    y: 2700,
    ssid: 'Showcase-EM',
    band: '6G',
    standard: '802.11be',
    channel: 37,
    host: 17,
    peers: [{ template: 'pc-tablet', label: '平板（电磁波）', dx: 330, dy: 150 }],
  },
  {
    animation: 'mimo',
    template: 'bs-5g',
    label: '5G 基站 B Massive MIMO 波束',
    radiusM: 80,
    x: 1450,
    y: 2700,
    plmn: '46000',
    host: 18,
    peers: [
      { template: 'mobile-phone', label: '手机 A（MIMO 波束）', dx: 400, dy: -250 },
      { template: 'mobile-phone', label: '手机 B（MIMO 波束）', dx: 430, dy: 120 },
      { template: 'pc-tablet', label: '平板（MIMO 波束）', dx: 380, dy: 430 },
    ],
  },
  {
    animation: 'pulse',
    template: 'ap',
    label: 'AP-7 脉冲闪烁',
    radiusM: 26,
    x: 2600,
    y: 2700,
    ssid: 'Showcase-Pulse',
    band: '2.4G',
    standard: '802.11n',
    channel: 1,
    host: 19,
    peers: [{ template: 'mobile-phone', label: '手机（脉冲）', dx: 330, dy: 160 }],
  },
];

export function buildAnimationsScenario(): Scenario {
  const make = (key: string, id: string, name: string, x: number, y: number): Device =>
    instantiate(key, id, name, x, y);

  // 三条公网/汇聚设备摆在九宫格正上方（与网格中心 x 对齐），回程缆扇才不会全从角落斜穿画面
  const cloud = make('cloud', 'dev-cloud', '云 / 互联网', 1150, 60);
  const ont = make('ont', 'dev-ont', '光猫（路由模式）', 1450, 60);
  const sw = make('switch-24-1g', 'dev-sw', '接入交换机', 1750, 60);

  // ── 公网侧：云提供公网目标与权威 DNS，光猫在公网段拿地址
  cloud.l3.interfaces = [{ id: 'l3-cloud', portId: 'port-sfp1', ip: '203.0.113.1', prefix: 24 }];
  cloud.services.dns = {
    enabled: true,
    records: [{ id: 'rec-www', name: 'www.example.com', ip: '203.0.113.1' }],
    forwarders: [],
  };
  ont.l3.interfaces = [
    { id: 'l3-ont-wan', portId: 'port-pon1', ip: '203.0.113.10', prefix: 24 },
    { id: 'l3-ont-lan', portId: 'port-ge1', ip: '192.168.50.1', prefix: 24 },
  ];
  ont.l3.defaultGateway = '203.0.113.1';
  /*
   * 这一屏的 WiFi 由九台 AP/基站提供，光猫自己的无线**关掉**：
   * 否则它是第 10 个"提供方"，会多画一个没有动画的覆盖圈、破坏"九格一形态"的对照关系。
   * （带无线口但没有无线配置在本项目里是合法状态 —— 桥接模式的 ont-bridge 就是这样。）
   */
  delete ont.wireless;
  ont.services.nat = true;
  ont.services.dhcp = {
    enabled: true,
    poolStart: '192.168.50.100',
    poolEnd: '192.168.50.200',
    gateway: '192.168.50.1',
    dns: ['192.168.50.1'],
  };
  ont.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.1'] };
  sw.l3.interfaces = [{ id: 'l3-sw', portId: 'port-ge1', ip: '192.168.50.2', prefix: 24 }];
  sw.l3.defaultGateway = '192.168.50.1';

  const devices: Device[] = [cloud, ont, sw];
  const cables: Cable[] = [
    // 运营商光纤直接进光猫（这一屏不建模 OLT，省下的地方留给九种动画）
    { id: 'cbl-wan', type: 'lc-sm', lengthM: 2000, a: { deviceId: cloud.id, portId: 'port-sfp1' }, b: { deviceId: ont.id, portId: 'port-pon1' } },
    { id: 'cbl-ont-sw', type: 'cat6', lengthM: 5, a: { deviceId: ont.id, portId: 'port-ge1' }, b: { deviceId: sw.id, portId: 'port-ge1' } },
  ];

  CELLS.forEach((cell, index) => {
    const id = `dev-${cell.animation}`;
    const provider = make(cell.template, id, cell.label, cell.x, cell.y);
    const cellular = cell.template === 'bs-5g';
    provider.wireless = cellular
      ? {
          ...(provider.wireless ?? { mode: 'ap' as const }),
          mode: 'ap',
          standard: 'nr',
          plmn: cell.plmn,
          animation: cell.animation,
          coverage: omniCoverage(cell.radiusM),
        }
      : {
          ...(provider.wireless ?? { mode: 'ap' as const }),
          mode: 'ap',
          ssid: cell.ssid,
          band: cell.band,
          standard: cell.standard,
          channel: cell.channel,
          animation: cell.animation,
          coverage: omniCoverage(cell.radiusM),
        };
    provider.l3.interfaces = [
      { id: `l3-${id}`, portId: 'port-ge1', ip: `192.168.50.${cell.host}`, prefix: 24 },
    ];
    provider.l3.defaultGateway = '192.168.50.1';
    devices.push(provider);

    // 回程：交换机第 (index+2) 口 → 提供方的电口
    cables.push({
      id: `cbl-sw-${cell.animation}`,
      type: 'cat6',
      lengthM: 20 + index * 8,
      a: { deviceId: sw.id, portId: `port-ge${index + 2}` },
      b: { deviceId: provider.id, portId: 'port-ge1' },
    });

    cell.peers.forEach((peerSpec, peerIndex) => {
      const peerId = cell.peers.length > 1 ? `dev-${cell.animation}-peer-${peerIndex + 1}` : `dev-${cell.animation}-peer`;
      const peer = make(peerSpec.template, peerId, peerSpec.label, cell.x + peerSpec.dx, cell.y + peerSpec.dy);
      peer.wireless = cellular
        ? { mode: 'sta', standard: 'nr', plmn: cell.plmn }
        : { mode: 'sta', ssid: cell.ssid, band: cell.band, standard: cell.standard };
      peer.client = { mode: 'dhcp', dns: [] };
      devices.push(peer);
      cables.push({
        id: `cbl-nr-${cell.animation}-${peerIndex + 1}`,
        type: 'wireless',
        lengthM: 0,
        a: { deviceId: provider.id, portId: 'port-wlan' },
        b: { deviceId: peer.id, portId: 'port-wlan' },
      });
    });
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-animations',
    name: '无线连接动画总览（九种形态同屏）',
    description:
      '九个小区各放一台提供接入的设备，分别指定九种动画表现形式：信号波（默认）、信号涟漪、波束扫描、' +
      '数据流光点、连接线、蜂窝网格、电磁波（6 GHz，频率最高所以波最密）、Massive MIMO 波束（一个阵列射向三台设备）、' +
      '脉冲闪烁。设备名就是图例，终端都在各自覆盖圈内，所以十一条无线关联全部成立（MIMO 那格三条）、九种动画同时在场。' +
      '把用户设置切到「统一动画」，九格会立刻变成同一种 —— 这个开关的意义一眼可见。',
    devices,
    cables,
    updatedAt: new Date().toISOString(),
  };
}
