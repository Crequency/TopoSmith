/**
 * 预置场景：中型托管 IDC（3 机房 × 24 柜 × 满配）
 *
 * 规模：**3 个机房**（A/B/C），每个机房 **24 个 42U 机柜**，柜内基本塞满；
 * 外加 1 个管理办公室与一套出口（OLT + 桥接光猫 + 出口路由器）。
 * 合计约 **800 台设备 / 800 条链路** —— 这也是画布与推演的**规模压测场景**
 * （docs/08-roadmap.md 的"画布规模压测"就靠它）。
 *
 * 机柜内部（42U 里占 40U）：
 *   U1–4    ToR 接入交换机（24×1G + 2×10G SFP+）
 *   U5–40   9 台 4U 服务器，每台 1 根 CAT6a 到 ToR 的 GE1–GE9（千兆管理网）
 * 机柜上联：ToR 的 GE10/GE11 **双千兆**上联到本机房汇聚（每台汇聚正好接满 12 个机柜的 24 个口）
 *
 * 分层：机柜 ToR →（双千兆）→ 机房汇聚 1/2 →（万兆 DAC）→ 核心交换机对 →（万兆）→ 出口路由器 → 桥接光猫 → OLT → 云
 *
 * 地址规划（三个机房三个 /16，机房之间靠出口路由器转发）：
 *   公网        203.0.113.0/24   ISP 网关 .1、权威 DNS .10、OLT 上联 .2
 *   接入段      100.64.0.0/24    OLT .1、出口路由器 WAN .20
 *   A/B/C 机房  10.10/10.20/10.30.0.0/16
 *                机柜 n（1–24）→ 10.R.n.0/24：ToR .2、服务器 .11–.19
 *                机房汇聚 .0.11 / .0.12、出口路由器侧网关 .0.1
 *   管理办公室  10.40.0.0/24     出口路由器 .1、交换机 .2、AP .3、终端 DHCP .100+
 *
 * **已知简化（M0 引擎限制，见 D-43 / D-44）**：
 *   1. 引擎没有"交换机三层接口 / VLAN 子接口"，所以三个机房的网关
 *      （10.10.0.1 / 10.20.0.1 / 10.30.0.1 / 10.40.0.1）**全部落在出口路由器的同一个物理口上**，
 *      整座 IDC 是同一条二层域。真实 IDC 会用 VLAN 把机房隔开；
 *   2. 服务器与 ToR 的地址都必须挂在**有连线的端口**上（否则 ARP 永远解析不到），
 *      所以 ToR 的管理地址挂在它的上联口 GE10 上；
 *   3. 服务器缺省是 DHCP 客户端，这里逐个显式退出 DHCP 用静态地址
 *      （全网 648 台服务器不可能靠一个地址池）。
 */

import { instantiate } from '@toposmith/catalog';
import { rackMountPosition } from '../lib/geometry';
import { SCHEMA_VERSION, type Cable, type Device, type Scenario } from '@toposmith/schema';

/** 机房定义：字母 + 管理段第二段 */
const ROOMS = [
  { letter: 'A', seg: 10, originY: 0 },
  { letter: 'B', seg: 20, originY: 2300 },
  { letter: 'C', seg: 30, originY: 4600 },
] as const;

const RACKS_PER_ROOM = 24;
const RACKS_PER_ROW = 12;
const SERVERS_PER_RACK = 9;
const RACK_HEIGHT_U = 42;
/** 机柜间距（世界坐标） */
const RACK_STEP_X = 350;
const ROW_STEP_Y = 1100;
/** 机房左侧放汇聚交换机的位置 */
const AGG_X = -380;
/** 最左侧放出口 / 核心 / 办公区的位置 */
const CORE_X = -760;

export function buildIdcScenario(): Scenario {
  const devices: Device[] = [];
  const cables: Cable[] = [];
  let cableSeq = 0;
  const link = (
    type: Cable['type'],
    lengthM: number,
    a: { deviceId: string; portId: string },
    b: { deviceId: string; portId: string },
  ): void => {
    cableSeq += 1;
    cables.push({ id: `cbl-idc-${cableSeq}`, type, lengthM, a, b });
  };

  /* ── 出口侧：云 → OLT → 桥接光猫 → 出口路由器 ── */
  const cloud = instantiate('cloud', 'dev-cloud', '云 / 互联网', CORE_X, 40);
  cloud.l3.interfaces = [
    { id: 'l3-cloud-gw', portId: 'port-sfp1', ip: '203.0.113.1', prefix: 24 },
    { id: 'l3-cloud-dns', portId: 'port-sfp1', ip: '203.0.113.10', prefix: 24 },
  ];
  cloud.services.dns = {
    enabled: true,
    records: [
      { id: 'rec-www', name: 'www.example.com', ip: '203.0.113.10' },
      { id: 'rec-ops', name: 'ops.idc.example.com', ip: '10.40.0.3' },
    ],
    forwarders: [],
  };

  const olt = instantiate('olt', 'dev-olt', 'OLT 局端', CORE_X, 200);
  olt.l3.interfaces = [
    { id: 'l3-olt-pon', portId: 'port-pon1', ip: '100.64.0.1', prefix: 24 },
    { id: 'l3-olt-sfp', portId: 'port-sfp1', ip: '203.0.113.2', prefix: 24 },
  ];

  const ont = instantiate('ont-bridge', 'dev-ont', '专线光猫（桥接）', CORE_X, 360);

  const router = instantiate('router', 'dev-router', 'IDC 出口路由器', CORE_X, 520);
  /*
   * 四个网关地址全在同一个物理口（sfp-1）上 —— 见文件头的"已知简化 1"。
   * 万兆口与核心交换机对相连，于是机房之间的流量走的是万兆。
   */
  router.l3.interfaces = [
    { id: 'l3-rt-wan', portId: 'port-wan1', ip: '100.64.0.20', prefix: 24 },
    { id: 'l3-rt-a', portId: 'port-sfp-1', ip: '10.10.0.1', prefix: 16 },
    { id: 'l3-rt-b', portId: 'port-sfp-1', ip: '10.20.0.1', prefix: 16 },
    { id: 'l3-rt-c', portId: 'port-sfp-1', ip: '10.30.0.1', prefix: 16 },
    { id: 'l3-rt-office', portId: 'port-sfp-1', ip: '10.40.0.1', prefix: 24 },
  ];
  router.l3.defaultGateway = '100.64.0.1';
  router.services.nat = true;
  router.services.dhcp = {
    enabled: true,
    poolStart: '10.40.0.100',
    poolEnd: '10.40.0.120',
    gateway: '10.40.0.1',
    dns: ['10.40.0.1'],
  };
  router.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.10'] };

  const coreA = instantiate('switch-24-1g', 'dev-core-1', '核心交换机 1', CORE_X, 700);
  const coreB = instantiate('switch-24-1g', 'dev-core-2', '核心交换机 2', CORE_X, 860);
  coreA.l3.interfaces = [{ id: 'l3-core1', portId: 'port-sfp-1', ip: '10.40.0.4', prefix: 24 }];
  coreA.l3.defaultGateway = '10.40.0.1';
  // 核心 2 的管理地址也挂在上联口（sfp-1 接 B 机房汇聚）
  coreB.l3.interfaces = [{ id: 'l3-core2', portId: 'port-sfp-1', ip: '10.40.0.5', prefix: 24 }];
  coreB.l3.defaultGateway = '10.40.0.1';

  devices.push(cloud, olt, ont, router, coreA, coreB);
  link('lc-sm', 1500, { deviceId: cloud.id, portId: 'port-sfp1' }, { deviceId: olt.id, portId: 'port-sfp1' });
  link('lc-sm', 700, { deviceId: olt.id, portId: 'port-pon1' }, { deviceId: ont.id, portId: 'port-pon1' });
  link('cat6', 3, { deviceId: ont.id, portId: 'port-ge1' }, { deviceId: router.id, portId: 'port-wan1' });
  // 出口路由器 ↔ 核心交换机对：万兆 DAC（机房之间的流量走这里）
  link('dac', 5, { deviceId: router.id, portId: 'port-sfp-1' }, { deviceId: coreA.id, portId: 'port-sfp-1' });
  // 核心对之间的千兆互联
  link('cat6a', 2, { deviceId: coreA.id, portId: 'port-ge1' }, { deviceId: coreB.id, portId: 'port-ge1' });

  /* ── 三个机房 ── */
  ROOMS.forEach((room, roomIndex) => {
    const agg1 = instantiate('switch-24-1g', `dev-agg-${room.letter}-1`, `${room.letter} 机房汇聚 1`, AGG_X, room.originY + 320);
    const agg2 = instantiate('switch-24-1g', `dev-agg-${room.letter}-2`, `${room.letter} 机房汇聚 2`, AGG_X, room.originY + 760);
    // 汇聚的管理地址挂在万兆上联口上（那是它唯一"有线"的口）
    agg1.l3.interfaces = [{ id: `l3-agg-${room.letter}-1`, portId: 'port-sfp-1', ip: `10.${room.seg}.0.11`, prefix: 16 }];
    agg1.l3.defaultGateway = `10.${room.seg}.0.1`;
    agg2.l3.interfaces = [{ id: `l3-agg-${room.letter}-2`, portId: 'port-sfp-1', ip: `10.${room.seg}.0.12`, prefix: 16 }];
    agg2.l3.defaultGateway = `10.${room.seg}.0.1`;
    devices.push(agg1, agg2);

    /*
     * 汇聚 2 → 汇聚 1（万兆），汇聚 1 → 核心（万兆）。
     *
     * 两个坑：① DAC 有长度上限（8 m 会被判 LINK_TOO_LONG），跨机柜跳线要用光纤；
     * ② 核心交换机 1 的两个 SFP+ 已被出口与 A 机房占用，B/C 机房必须上核心交换机 2 ——
     * 光纤插到电口上会直接 MEDIUM_MISMATCH（链路 down）。
     */
    link('lc-om4', 30, { deviceId: agg2.id, portId: 'port-sfp-1' }, { deviceId: agg1.id, portId: 'port-sfp-2' });
    const uplink = roomIndex === 0 ? { core: coreA, port: 'port-sfp-2' } : { core: coreB, port: roomIndex === 1 ? 'port-sfp-1' : 'port-sfp-2' };
    link('lc-om4', 60, { deviceId: agg1.id, portId: 'port-sfp-1' }, { deviceId: uplink.core.id, portId: uplink.port });

    for (let n = 1; n <= RACKS_PER_ROOM; n += 1) {
      const label = `${room.letter}-${String(n).padStart(2, '0')}`;
      const row = Math.floor((n - 1) / RACKS_PER_ROW);
      const col = (n - 1) % RACKS_PER_ROW;
      const rackX = col * RACK_STEP_X;
      const rackY = room.originY + row * ROW_STEP_Y;

      const rack = instantiate('rack-24u', `dev-rack-${room.letter}${n}`, `${label} 机柜`, rackX, rackY);
      rack.rack = { heightU: RACK_HEIGHT_U, flipped: false };
      devices.push(rack);

      // ToR：U1–4
      const tor = instantiate('switch-24-1g', `dev-tor-${room.letter}${n}`, `${label} ToR`, rackX, rackY);
      tor.rackUnits = 4;
      mount(tor, rack, 1);
      // 管理地址挂在上联口 GE10（有连线的口）
      tor.l3.interfaces = [
        { id: `l3-tor-${room.letter}${n}`, portId: 'port-ge10', ip: `10.${room.seg}.${n}.2`, prefix: 16 },
      ];
      tor.l3.defaultGateway = `10.${room.seg}.0.1`;
      devices.push(tor);

      // 服务器：U5 起每台 4U，共 9 台（占到 U40，剩 2U）
      for (let s = 1; s <= SERVERS_PER_RACK; s += 1) {
        const srv = instantiate(
          'server-rack',
          `dev-srv-${room.letter}${n}-${s}`,
          `${label} 服务器 ${s}`,
          rackX,
          rackY,
        );
        srv.rackUnits = 4;
        mount(srv, rack, 5 + (s - 1) * 4);
        srv.l3.interfaces = [
          {
            id: `l3-srv-${room.letter}${n}-${s}`,
            portId: 'port-ge1',
            ip: `10.${room.seg}.${n}.${10 + s}`,
            prefix: 16,
          },
        ];
        srv.l3.defaultGateway = `10.${room.seg}.0.1`;
        // 退出 DHCP：租约会覆盖 l3.interfaces（见文件头"已知简化 3"）
        srv.client = { mode: 'static', dns: [`10.${room.seg}.0.1`] };
        devices.push(srv);
        link('cat6a', 3, { deviceId: tor.id, portId: `port-ge${s}` }, { deviceId: srv.id, portId: 'port-ge1' });
      }

      // 双千兆上联：前 12 柜 → 汇聚 1，后 12 柜 → 汇聚 2（每台汇聚正好接满 24 口）
      const agg = n <= RACKS_PER_ROW ? agg1 : agg2;
      const aggPortBase = ((n - 1) % RACKS_PER_ROW) * 2 + 1;
      link('cat6a', 20, { deviceId: tor.id, portId: 'port-ge10' }, { deviceId: agg.id, portId: `port-ge${aggPortBase}` });
      link('cat6a', 20, { deviceId: tor.id, portId: 'port-ge11' }, { deviceId: agg.id, portId: `port-ge${aggPortBase + 1}` });
    }
  });

  /* ── 管理办公室 ── */
  const officeSw = instantiate('switch-8-1g', 'dev-office-sw', '办公区交换机', CORE_X, 1180);
  officeSw.l3.interfaces = [{ id: 'l3-office-sw', portId: 'port-ge1', ip: '10.40.0.2', prefix: 24 }];
  officeSw.l3.defaultGateway = '10.40.0.1';
  const officeAp = instantiate('ap', 'dev-office-ap', '办公区 AP', CORE_X + 360, 1180);
  officeAp.l3.interfaces = [{ id: 'l3-office-ap', portId: 'port-ge1', ip: '10.40.0.3', prefix: 24 }];
  officeAp.l3.defaultGateway = '10.40.0.1';
  officeAp.wireless = { mode: 'ap', ssid: 'IDC-Ops', band: '5G', standard: '802.11ax', channel: 36 };

  const officePc1 = instantiate('pc-desktop', 'dev-office-pc1', '办公区 PC 1', CORE_X, 1420);
  const officePc2 = instantiate('pc-desktop', 'dev-office-pc2', '办公区 PC 2', CORE_X + 220, 1420);
  const officeLap = instantiate('pc-laptop', 'dev-office-lap', '值班笔记本', CORE_X + 440, 1420);
  const officePhone = instantiate('mobile-phone', 'dev-office-phone', '值班手机', CORE_X + 660, 1420);
  for (const host of [officePc1, officePc2, officeLap, officePhone]) {
    host.client = { mode: 'dhcp', dns: [] };
  }
  officeLap.wireless = { mode: 'sta', ssid: 'IDC-Ops', band: '5G', standard: '802.11ax' };
  officePhone.wireless = { mode: 'sta', ssid: 'IDC-Ops', band: '5G', standard: '802.11ac' };
  devices.push(officeSw, officeAp, officePc1, officePc2, officeLap, officePhone);

  // 办公室挂在核心交换机 1 上
  link('cat6a', 40, { deviceId: officeSw.id, portId: 'port-ge2' }, { deviceId: coreA.id, portId: 'port-ge3' });
  link('cat6a', 25, { deviceId: officeSw.id, portId: 'port-ge3' }, { deviceId: officeAp.id, portId: 'port-ge1' });
  link('cat6a', 15, { deviceId: officeSw.id, portId: 'port-ge4' }, { deviceId: officePc1.id, portId: 'port-ge1' });
  link('cat6a', 15, { deviceId: officeSw.id, portId: 'port-ge5' }, { deviceId: officePc2.id, portId: 'port-ge1' });
  link('wireless', 0, { deviceId: officeAp.id, portId: 'port-wlan' }, { deviceId: officeLap.id, portId: 'port-wlan' });
  link('wireless', 0, { deviceId: officeAp.id, portId: 'port-wlan' }, { deviceId: officePhone.id, portId: 'port-wlan' });

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-idc',
    name: '中型托管 IDC（3 机房 × 24 柜）',
    description:
      '三个机房各 24 个 42U 机柜，柜内 1 台 ToR + 9 台 4U 服务器（占 40U），' +
      'ToR 双千兆上联到机房汇聚，汇聚经万兆到核心交换机对，再由出口路由器（万兆）出网；' +
      '另有 1 个管理办公室。**这是规模压测场景**：约 800 台设备、800 条链路 —— ' +
      '画布、节点树与推演都按这个量级验收。',
    devices,
    cables,
    updatedAt: new Date().toISOString(),
  };
}

/** 上架并摆到机柜内的位置（与 UI 拖放上架算的是同一套几何） */
function mount(device: Device, rack: Device, startU: number): void {
  device.mount = { rackId: rack.id, startU };
  const position = rackMountPosition(rack, startU, device.rackUnits ?? 4);
  device.x = position.x;
  device.y = position.y;
}
