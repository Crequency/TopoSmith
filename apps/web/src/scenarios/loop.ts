/**
 * 预置场景：网络环路与广播风暴（三处典型成环 + 一段干净 VLAN 作对照）
 *
 * 这个场景演示的是**最容易把整张网打瘫、又最难靠"看单台设备"发现的那类故障**：
 * 二层环路。三处环都不是"设计出来的冗余"，而是三件真实会发生的事：
 *
 *   ① **双上行没做聚合**：一楼接入交换机（sw-a）与二楼接入交换机（sw-b）之间
 *      有人"为了冗余"多插了一根网线（GE23/GE24 两根），既没做 LACP，交换机也没有 STP；
 *   ② **一根跳线两端插在同一台交换机上**：sw-b 的 GE7 与 GE8 被一根 1 m 跳线连起来
 *      （机柜里常见的"随手一插"），这台交换机自己就成了一个环；
 *   ③ **无线中继又接了网线**：二楼 AP（ap2）用网线接回 sw-b，同时无线中继到办公 AP（ap1）。
 *      AP 是二层转发设备，于是"无线 + 有线"绕过交换机形成第三个环 ——
 *      环路不必全是有线，这一点最容易被忽略。
 *
 * 三处环都在 **VLAN 1（办公段）**，所以办公段里每一台设备都会被广播风暴波及；
 * 而 **VLAN 20（服务器段）**只挂在核心交换机上、本身是棵树，**完全不受影响** ——
 * 这是本场景的对照组：风暴不会跨 VLAN（现场把服务器塞进另一个 VLAN 就是这么救的）。
 *
 * 地址规划：
 *   公网        203.0.113.0/24    云 .10、OLT 上联 .1
 *   接入段      100.64.0.0/24     OLT .1、光猫 WAN .10
 *   出口段      192.168.0.0/24    光猫 LAN .1、路由器 WAN .2
 *   办公 VLAN1  192.168.10.0/24   路由器 .1、AP .2/.3、交换机 .4–.6、终端 .11+ / DHCP .100+
 *   服务器 VLAN20 192.168.20.0/24  路由器 .1、两台服务器 .10/.11（**无环，用作对照**）
 *
 * 为什么办公段留在 **VLAN 1**：M0 的「家用网关 LAN 桥」只在 VLAN 1 生效
 * （`LAN_BRIDGE_VLAN`，D-17），无线要并进有线段就必须待在 VLAN 1 —— 与办公网场景同源。
 *
 * 三处环**都能修好**（`presets.test.ts` 逐个验过）：
 *   ① 拆掉冗余两根里的一根（或把两根都勾成链路聚合）→ 环路消失；
 *   ② 拔掉 GE7–GE8 那根跳线；
 *   ③ 撤掉 ap2 的无线中继（它已经被网线接回交换机了，不需要再当中继）。
 * 对照：把 VLAN 20 的两台服务器拿来做诊断，任何一处环都不会报出来。
 */

import { instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, type Cable, type Device, type Scenario } from '@toposmith/schema';

export function buildLoopScenario(): Scenario {
  const make = (key: string, id: string, name: string, x: number, y: number): Device =>
    instantiate(key, id, name, x, y);

  /*
   * 坐标按"自上而下、自左向右"的信息流排：出口在最左，接入交换机在右，
   * 环路两侧（一楼/二楼）各占一列 —— 两根冗余线因此在画面上是两条短竖线，
   * 一眼就能看出"同一对设备之间接了两根"。行距按卡片高度（86）留够而不多留：
   * 场景太高会让适应视图被迫缩得更小（与办公网场景的构图收紧同理，FR-62）。
   */
  const cloud = make('cloud', 'dev-cloud', '云 / 互联网', 60, 40);
  const olt = make('olt', 'dev-olt', 'OLT 局端', 60, 220);
  const ont = make('ont', 'dev-ont', '企业光猫', 60, 400);
  const router = make('router', 'dev-router', '企业路由器', 380, 400);
  const swCore = make('switch-24-1g', 'dev-sw-core', '核心交换机', 700, 400);
  const srv = make('server-rack', 'dev-srv', '仓储服务器', 700, 40);
  const srv2 = make('server-rack', 'dev-srv2', '备份服务器', 700, 200);
  const swA = make('switch-24-1g', 'dev-sw-a', '一楼接入交换机', 1020, 400);
  const swB = make('switch-24-1g', 'dev-sw-b', '二楼接入交换机', 1340, 400);
  const ap1 = make('ap', 'dev-ap1', '办公 AP', 1020, 700);
  const ap2 = make('ap', 'dev-ap2', '二楼中继 AP', 1340, 700);
  const pc1 = make('pc-desktop', 'dev-pc1', '财务台式机', 1020, 860);
  const printer = make('printer', 'dev-printer', '网络打印机', 1020, 1020);
  const pc2 = make('workstation-tower', 'dev-pc2', '仓储工作站', 1340, 860);
  const camera = make('camera', 'dev-camera', '仓库摄像头', 1340, 1020);
  const laptop = make('pc-laptop', 'dev-laptop', '笔记本', 1020, 1180);
  const phone = make('mobile-phone', 'dev-phone', '员工手机', 1340, 1180);

  // ── 云侧：权威 DNS（把服务器域名也挂在公网权威上，便于演示"DNS 通了但网瘫了"）
  cloud.l3.interfaces = [{ id: 'l3-cloud', portId: 'port-sfp1', ip: '203.0.113.10', prefix: 24 }];
  cloud.services.dns = {
    enabled: true,
    records: [
      { id: 'rec-www', name: 'www.example.com', ip: '203.0.113.10' },
      { id: 'rec-wms', name: 'wms.example.com', ip: '192.168.20.10' },
    ],
    forwarders: [],
  };

  olt.l3.interfaces = [
    { id: 'l3-olt-pon', portId: 'port-pon1', ip: '100.64.0.1', prefix: 24 },
    { id: 'l3-olt-sfp', portId: 'port-sfp1', ip: '203.0.113.1', prefix: 24 },
  ];

  // ── 光猫（路由模式）：只做出口转换，办公/服务器两段都由企业路由器负责
  ont.l3.interfaces = [
    { id: 'l3-ont-wan', portId: 'port-pon1', ip: '100.64.0.10', prefix: 24 },
    { id: 'l3-ont-lan', portId: 'port-ge1', ip: '192.168.0.1', prefix: 24 },
  ];
  ont.l3.defaultGateway = '100.64.0.1';
  ont.services.nat = true;
  ont.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.10'] };

  /*
   * ── 企业路由器：WAN 走光猫，GE2 是办公段（VLAN 1），GE3 是服务器段（VLAN 20）
   *
   * DHCP 只服务办公段；服务器段用手工地址，避免"地址池到处发"的假象。
   * 注意：路由模式网关的 LAN 口内部是桥接的（`bridgesLanPorts`），但**桥内也按 VLAN 分** ——
   * GE3 被划到 VLAN 20 之后就不在 VLAN 1 那座桥里了，否则两个 VLAN 会被接成一座桥并凭空成环（D-51）。
   */
  router.l3.interfaces = [
    { id: 'l3-rt-wan', portId: 'port-wan1', ip: '192.168.0.2', prefix: 24 },
    { id: 'l3-rt-office', portId: 'port-ge2', ip: '192.168.10.1', prefix: 24 },
    { id: 'l3-rt-srv', portId: 'port-ge3', ip: '192.168.20.1', prefix: 24 },
  ];
  router.ports = router.ports.map((port) =>
    port.id === 'port-ge3' ? { ...port, vlan: 20 } : port,
  );
  router.l3.defaultGateway = '192.168.0.1';
  router.services.nat = true;
  router.services.dhcp = {
    enabled: true,
    poolStart: '192.168.10.100',
    poolEnd: '192.168.10.150',
    gateway: '192.168.10.1',
    dns: ['192.168.10.1'],
  };
  router.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.10'] };

  /*
   * ── 核心交换机：办公段上联（GE1）+ 服务器段上联（GE2）+ 一楼接入（GE3）+ 两台服务器（GE4/GE5）
   *
   * 服务器段的三个口（GE2/GE4/GE5）划到 VLAN 20，其余留在默认 VLAN 1。
   * 这一段**没有环路**，它是本场景的对照组。
   */
  swCore.l3.interfaces = [{ id: 'l3-sw-core', portId: 'port-ge1', ip: '192.168.10.4', prefix: 24 }];
  swCore.l3.defaultGateway = '192.168.10.1';
  swCore.ports = swCore.ports.map((port) =>
    port.id === 'port-ge2' || port.id === 'port-ge4' || port.id === 'port-ge5'
      ? { ...port, role: 'access', vlan: 20 }
      : { ...port, role: 'access', vlan: 1 },
  );

  /*
   * ── 一楼接入交换机：办公 AP、财务台式机、打印机挂在它上面
   * GE23/GE24 是那两根"冗余"上行 —— **没有标 `bonded`**，所以它们就是环路本体。
   * 办公段设备全在默认 VLAN 1，这里把角色显式写成 access 只是为了面板上读得清楚。
   */
  swA.l3.interfaces = [{ id: 'l3-sw-a', portId: 'port-ge1', ip: '192.168.10.5', prefix: 24 }];
  swA.l3.defaultGateway = '192.168.10.1';
  swA.ports = swA.ports.map((port) => ({ ...port, role: 'access' as const, vlan: 1 }));

  /*
   * ── 二楼接入交换机：二楼中继 AP、工作站、仓库摄像头
   * GE7/GE8 之间那根跳线是第二处环（一根线两端插在自己身上）；
   * 地址挂在 GE23 上（有连线的口，见 FR-55）。
   */
  swB.l3.interfaces = [{ id: 'l3-sw-b', portId: 'port-ge23', ip: '192.168.10.6', prefix: 24 }];
  swB.l3.defaultGateway = '192.168.10.1';
  swB.ports = swB.ports.map((port) => ({ ...port, role: 'access' as const, vlan: 1 }));

  // ── 两台 AP：同一 SSID；ap2 做成"中继"（sta 关联 ap1），同时又用网线接回交换机
  ap1.l3.interfaces = [{ id: 'l3-ap1', portId: 'port-ge1', ip: '192.168.10.2', prefix: 24 }];
  ap1.l3.defaultGateway = '192.168.10.1';
  ap1.wireless = { mode: 'ap', ssid: 'TopoSmith-Warehouse', band: '5G', standard: '802.11ax', channel: 44 };
  ap2.l3.interfaces = [{ id: 'l3-ap2', portId: 'port-ge1', ip: '192.168.10.3', prefix: 24 }];
  ap2.l3.defaultGateway = '192.168.10.1';
  ap2.wireless = { mode: 'sta', ssid: 'TopoSmith-Warehouse', band: '5G', standard: '802.11ax' };

  // ── 服务器段：地址挂在有连线的口上，且必须显式退出 DHCP（租约会覆盖静态地址）
  srv.l3.interfaces = [{ id: 'l3-srv', portId: 'port-ge1', ip: '192.168.20.10', prefix: 24 }];
  srv.l3.defaultGateway = '192.168.20.1';
  srv.client = { mode: 'static', dns: ['192.168.20.1'] };
  srv.ports = srv.ports.map((port) => (port.id === 'port-ge1' ? { ...port, vlan: 20 } : port));
  srv2.l3.interfaces = [{ id: 'l3-srv2', portId: 'port-ge1', ip: '192.168.20.11', prefix: 24 }];
  srv2.l3.defaultGateway = '192.168.20.1';
  srv2.client = { mode: 'static', dns: ['192.168.20.1'] };
  srv2.ports = srv2.ports.map((port) => (port.id === 'port-ge1' ? { ...port, vlan: 20 } : port));

  // ── 办公段终端：打印机与摄像头用固定地址（显式 static），其余走 DHCP
  const staticAt = (device: Device, ip: string, gateway: string): void => {
    device.client = { mode: 'static', ip, prefix: 24, gateway, dns: [gateway] };
  };
  staticAt(printer, '192.168.10.11', '192.168.10.1');
  staticAt(camera, '192.168.10.12', '192.168.10.1');
  for (const host of [pc1, pc2, laptop, phone]) {
    host.client = { mode: 'dhcp', dns: [] };
  }
  laptop.wireless = { mode: 'sta', ssid: 'TopoSmith-Warehouse', band: '5G', standard: '802.11ac' };
  phone.wireless = { mode: 'sta', ssid: 'TopoSmith-Warehouse', band: '5G', standard: '802.11ax' };

  const devices: Device[] = [
    cloud, olt, ont, router, swCore, srv, srv2, swA, swB, ap1, ap2, pc1, printer, pc2, camera, laptop, phone,
  ];

  const cables: Cable[] = [
    { id: 'cbl-backbone', type: 'lc-sm', lengthM: 1200, a: { deviceId: cloud.id, portId: 'port-sfp1' }, b: { deviceId: olt.id, portId: 'port-sfp1' } },
    { id: 'cbl-pon', type: 'lc-sm', lengthM: 400, a: { deviceId: olt.id, portId: 'port-pon1' }, b: { deviceId: ont.id, portId: 'port-pon1' } },
    { id: 'cbl-ont-rt', type: 'cat6', lengthM: 3, a: { deviceId: ont.id, portId: 'port-ge1' }, b: { deviceId: router.id, portId: 'port-wan1' } },
    // 路由器两个 LAN 口 → 核心交换机同 VLAN 的上联口
    { id: 'cbl-rt-office', type: 'cat6', lengthM: 5, a: { deviceId: router.id, portId: 'port-ge2' }, b: { deviceId: swCore.id, portId: 'port-ge1' } },
    { id: 'cbl-rt-srv', type: 'cat6', lengthM: 5, a: { deviceId: router.id, portId: 'port-ge3' }, b: { deviceId: swCore.id, portId: 'port-ge2' } },
    // 服务器段（VLAN 20）：这段是棵树，风暴波及不到它
    { id: 'cbl-core-srv', type: 'cat6a', lengthM: 6, a: { deviceId: swCore.id, portId: 'port-ge4' }, b: { deviceId: srv.id, portId: 'port-ge1' } },
    { id: 'cbl-core-srv2', type: 'cat6a', lengthM: 8, a: { deviceId: swCore.id, portId: 'port-ge5' }, b: { deviceId: srv2.id, portId: 'port-ge1' } },
    // 核心交换机 → 一楼接入交换机（办公段唯一上行）
    { id: 'cbl-core-a', type: 'cat6', lengthM: 40, a: { deviceId: swCore.id, portId: 'port-ge3' }, b: { deviceId: swA.id, portId: 'port-ge1' } },
    // 一楼终端
    { id: 'cbl-a-ap1', type: 'cat6', lengthM: 15, a: { deviceId: swA.id, portId: 'port-ge2' }, b: { deviceId: ap1.id, portId: 'port-ge1' } },
    { id: 'cbl-a-pc1', type: 'cat6', lengthM: 12, a: { deviceId: swA.id, portId: 'port-ge3' }, b: { deviceId: pc1.id, portId: 'port-ge1' } },
    { id: 'cbl-a-printer', type: 'cat5e', lengthM: 6, a: { deviceId: swA.id, portId: 'port-ge4' }, b: { deviceId: printer.id, portId: 'port-ge1' } },
    /*
     * ── 环路 ①：一楼 ↔ 二楼之间的两根网线（"双上行冗余"，但既没做聚合也没有 STP）
     *
     * 这两根线只要勾上「链路聚合」（`bonded`）就变成一条逻辑链路、不再成环；
     * 或者拆掉其中一根、只留一根上行。见 D-50。
     */
    { id: 'cbl-redundant-1', type: 'cat6', lengthM: 25, a: { deviceId: swA.id, portId: 'port-ge23' }, b: { deviceId: swB.id, portId: 'port-ge23' } },
    { id: 'cbl-redundant-2', type: 'cat6', lengthM: 25, a: { deviceId: swA.id, portId: 'port-ge24' }, b: { deviceId: swB.id, portId: 'port-ge24' } },
    // ── 环路 ②：一根 1 m 跳线两端都插在二楼接入交换机上（最经典的"随手一插"）
    { id: 'cbl-self-loop', type: 'cat5e', lengthM: 1, a: { deviceId: swB.id, portId: 'port-ge7' }, b: { deviceId: swB.id, portId: 'port-ge8' } },
    // 二楼终端
    { id: 'cbl-b-ap2', type: 'cat6', lengthM: 20, a: { deviceId: swB.id, portId: 'port-ge12' }, b: { deviceId: ap2.id, portId: 'port-ge1' } },
    { id: 'cbl-b-pc2', type: 'cat6', lengthM: 10, a: { deviceId: swB.id, portId: 'port-ge14' }, b: { deviceId: pc2.id, portId: 'port-ge1' } },
    { id: 'cbl-b-camera', type: 'cat5e', lengthM: 35, a: { deviceId: swB.id, portId: 'port-ge13' }, b: { deviceId: camera.id, portId: 'port-fe1' } },
    /*
     * ── 环路 ③：ap2 既用网线接回交换机、又无线中继到 ap1 —— 无线也参与二层环路
     *
     * AP 是二层转发设备，它的无线口与有线口在同一座桥里，于是这条无线链路
     * 在 sw-a 与 sw-b 之间又架了一条"隐形"通路。撤掉中继（或撤掉有线）即解除。
     */
    { id: 'cbl-wifi-relay', type: 'wireless', lengthM: 0, a: { deviceId: ap2.id, portId: 'port-wlan' }, b: { deviceId: ap1.id, portId: 'port-wlan' } },
    { id: 'cbl-wifi-laptop', type: 'wireless', lengthM: 0, a: { deviceId: ap1.id, portId: 'port-wlan' }, b: { deviceId: laptop.id, portId: 'port-wlan' } },
    { id: 'cbl-wifi-phone', type: 'wireless', lengthM: 0, a: { deviceId: ap1.id, portId: 'port-wlan' }, b: { deviceId: phone.id, portId: 'port-wlan' } },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-loop',
    name: '网络环路与广播风暴（三处成环 + VLAN 对照）',
    description:
      '三处典型二层环路：一楼↔二楼两根"冗余"网线没做链路聚合、二楼交换机上一根跳线两端插在自己身上、' +
      '二楼 AP 既接网线又做无线中继。它们都在办公段（VLAN 1），诊断会点名环路径并说明广播风暴的后果；' +
      '服务器段（VLAN 20）没有环路，完全不受影响 —— 用同一个场景就能看出"风暴不跨 VLAN"。' +
      '**三处都能修好**：拆掉（或聚合）冗余线、拔掉自环跳线、撤掉无线中继。',
    devices,
    cables,
    updatedAt: new Date().toISOString(),
  };
}
