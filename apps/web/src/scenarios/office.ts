/**
 * 预置场景：小微企业办公网（多 VLAN + 机柜）
 *
 * 这个场景是**有意带一处配错的**：访客段的上联口（交换机 GE23）忘了打标，
 * 停在默认 VLAN 1，而路由器那一侧是 VLAN 20 —— 两台设备之间的直连链路
 * 不在同一广播域，于是"从办公电脑 ping 门口摄像头"会**明确报出 VLAN_MISMATCH**，
 * 并指名两个端口。在端口详情里把 GE23 的 PVID 改成 20 即可修好。
 *
 * 为什么要预置一个"坏"场景：预置场景不该只有"一切正常"的样子。用户需要一条
 * 能立刻复现的排查路径 —— 四类诊断的价值恰恰体现在**找出配错**的时候。
 *
 * 地址规划：
 *   公网          203.0.113.0/24    云 .10、OLT 上联 .1
 *   接入段        100.64.0.0/24     OLT .1、光猫 WAN .10
 *   企业出口      192.168.0.0/24    光猫 LAN .1、企业路由 WAN .2
 *   办公·无线 VLAN1  192.168.10.0/24 路由 .1、DHCP .100+
 *   访客 VLAN20   192.168.20.0/24   路由 .1、摄像头 .11
 *   服务器 VLAN30 192.168.30.0/24   路由 .1、业务服务器 .10
 *
 * 为什么办公段留在 **VLAN 1** 而不是另取一个号：M0 的「家用网关 LAN 桥」只在 VLAN 1 生效
 * （`LAN_BRIDGE_VLAN`，D-17），AP 的无线口要并进有线段就必须待在 VLAN 1 ——
 * 这是引擎的已知简化，不是场景的疏忽（见 docs/DECISIONS.md D-43）。
 */

import { instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, type Cable, type Device, type Scenario } from '@toposmith/schema';

export function buildOfficeScenario(): Scenario {
  const make = (key: string, id: string, name: string, x: number, y: number): Device =>
    instantiate(key, id, name, x, y);

  const cloud = make('cloud', 'dev-cloud', '云 / 互联网', 60, 40);
  const olt = make('olt', 'dev-olt', 'OLT 局端', 60, 210);
  const ont = make('ont', 'dev-ont', '企业光猫', 60, 380);
  const router = make('router', 'dev-router', '企业路由器', 360, 380);
  const rack = make('rack-24u', 'dev-rack', '机房机柜', 700, 120);
  rack.rack = { heightU: 24, flipped: false };
  const sw = make('switch-24-1g', 'dev-sw', '接入交换机', 0, 0);
  const srv = make('server-rack', 'dev-srv', '业务服务器', 0, 0);
  const ap = make('ap', 'dev-ap', '办公 AP', 1060, 380);
  const pc1 = make('pc-desktop', 'dev-pc1', '财务台式机', 1060, 560);
  const pc2 = make('workstation-tower', 'dev-pc2', '设计工作站', 1060, 660);
  const printer = make('printer', 'dev-printer', '网络打印机', 1360, 660);
  const nas = make('nas', 'dev-nas', '部门 NAS', 1060, 760);
  const camera = make('camera', 'dev-camera', '门口摄像头', 1360, 560);
  const laptop = make('pc-laptop', 'dev-laptop', '访客笔记本', 1360, 380);
  const phone = make('mobile-phone', 'dev-phone', '员工手机', 1360, 260);

  // ── 云侧：权威 DNS
  cloud.l3.interfaces = [{ id: 'l3-cloud', portId: 'port-sfp1', ip: '203.0.113.10', prefix: 24 }];
  cloud.services.dns = {
    enabled: true,
    records: [
      { id: 'rec-www', name: 'www.example.com', ip: '203.0.113.10' },
      { id: 'rec-erp', name: 'erp.example.com', ip: '192.168.30.10' },
    ],
    forwarders: [],
  };

  // ── OLT：接入汇聚
  olt.l3.interfaces = [
    { id: 'l3-olt-pon', portId: 'port-pon1', ip: '100.64.0.1', prefix: 24 },
    { id: 'l3-olt-sfp', portId: 'port-sfp1', ip: '203.0.113.1', prefix: 24 },
  ];

  // ── 光猫（路由模式）：只做出口转换，办公网由企业路由器负责
  ont.l3.interfaces = [
    { id: 'l3-ont-wan', portId: 'port-pon1', ip: '100.64.0.10', prefix: 24 },
    { id: 'l3-ont-lan', portId: 'port-ge1', ip: '192.168.0.1', prefix: 24 },
  ];
  ont.l3.defaultGateway = '100.64.0.1';
  ont.services.nat = true;
  ont.services.dhcp = {
    enabled: true,
    poolStart: '192.168.0.100',
    poolEnd: '192.168.0.150',
    gateway: '192.168.0.1',
    dns: ['192.168.0.1'],
  };
  ont.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.10'] };

  // ── 企业路由器：WAN 走光猫，三个 LAN 口分别是办公(VLAN1)/访客(VLAN20)/服务器(VLAN30)
  router.l3.interfaces = [
    { id: 'l3-rt-wan', portId: 'port-wan1', ip: '192.168.0.2', prefix: 24 },
    { id: 'l3-rt-office', portId: 'port-ge2', ip: '192.168.10.1', prefix: 24 },
    { id: 'l3-rt-guest', portId: 'port-ge3', ip: '192.168.20.1', prefix: 24 },
    { id: 'l3-rt-srv', portId: 'port-ge4', ip: '192.168.30.1', prefix: 24 },
  ];
  /*
   * 端口 PVID 必须与对端 VLAN 一致，否则广播域在两台设备之间就断了
   * （`portCarriesVlan` 只看 PVID）。三个 LAN 口各管一个段：
   * ge2 留在 VLAN 1（办公 + 无线），ge3 = 20（访客），ge4 = 30（服务器）。
   */
  router.ports = router.ports.map((port) => {
    if (port.id === 'port-ge3') return { ...port, vlan: 20 };
    if (port.id === 'port-ge4') return { ...port, vlan: 30 };
    return port;
  });
  router.l3.defaultGateway = '192.168.0.1';
  router.services.nat = true;
  // DHCP 只服务办公段：访客与服务器段用手工地址，避免"地址池到处发"的假象
  router.services.dhcp = {
    enabled: true,
    poolStart: '192.168.10.100',
    poolEnd: '192.168.10.150',
    gateway: '192.168.10.1',
    dns: ['192.168.10.1'],
  };
  router.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.10'] };

  /*
   * 接入交换机：三个段的上联口 + 各段的接入口。
   *
   * ge24 = 办公段上联（VLAN 1）、ge22 = 服务器上联（VLAN 30）、ge23 = 访客上联
   * —— **ge23 故意留在 VLAN 1**，而路由器那侧是 VLAN 20：这就是那处配错。
   * 其余端口按所属段设 PVID。
   */
  sw.ports = sw.ports.map((port) => {
    if (port.id === 'port-ge22') return { ...port, role: 'access', vlan: 30 };
    // 访客接入口（摄像头在 ge8）
    if (port.id === 'port-ge8') return { ...port, role: 'access', vlan: 20 };
    // 服务器接入口：SFP+ 到业务服务器
    if (port.id === 'port-sfp-1') return { ...port, role: 'access', vlan: 30 };
    // 其余（含 ge23 访客上联）都是办公段 / 默认 VLAN 1
    return { ...port, role: 'access', vlan: 1 };
  });

  // ── 上架：交换机与服务器装进机柜
  const swSlot = { startU: 1, rackId: rack.id };
  sw.mount = swSlot;
  sw.x = rack.x + 30;
  sw.y = rack.y + 32 + 12;
  const srvSlot = { startU: 6, rackId: rack.id };
  srv.mount = srvSlot;
  srv.x = rack.x + 30;
  srv.y = rack.y + 32 + 12 + 5 * 23;

  // ── AP：办公 WiFi（与办公 VLAN 同段，管理地址在办公网）
  ap.l3.interfaces = [{ id: 'l3-ap', portId: 'port-ge1', ip: '192.168.10.2', prefix: 24 }];
  ap.l3.defaultGateway = '192.168.10.1';
  ap.wireless = { mode: 'ap', ssid: 'TopoSmith-Office', band: '5G', standard: '802.11ax', channel: 44 };

  // 注意：地址必须挂在**有连线的端口**（这里是机柜里那根 SFP+ DAC），
  // 挂在没有线缆的口上，ARP 永远解析不到（engine 的地址模型就是这么定的）
  srv.l3.interfaces = [{ id: 'l3-srv', portId: 'port-sfp-1', ip: '192.168.30.10', prefix: 24 }];
  srv.l3.defaultGateway = '192.168.30.1';
  // 机架服务器模板缺省是 DHCP 客户端，而租约会**覆盖** l3.interfaces —— 要固定地址就得退出 DHCP
  srv.client = { mode: 'static', dns: ['192.168.30.1'] };
  /*
   * NAS / 打印机 / 摄像头用**固定地址**：终端型设备的 `client.mode` 缺省是 dhcp，
   * 而 DHCP 结果会**覆盖** `l3.interfaces`（model.ts 里 addresses.set 是赋值），
   * 所以这里必须显式声明 static —— 否则静态地址会被悄悄换成租约地址。
   */
  const staticAt = (device: Device, ip: string, gateway: string): void => {
    device.client = { mode: 'static', ip, prefix: 24, gateway, dns: [gateway] };
  };
  staticAt(nas, '192.168.10.11', '192.168.10.1');
  staticAt(printer, '192.168.10.12', '192.168.10.1');
  staticAt(camera, '192.168.20.11', '192.168.20.1');

  /*
   * 端口 PVID **两端都要对上**：`portCarriesVlan` 看的是"端口承载哪个 VLAN"，
   * 广播域跨线缆时会检查对端端口是否也承载这个 VLAN。真实网络里 VLAN 打在交换机口上、
   * 终端网卡并不打标；M0 按"两端同 VLAN"建模（已知简化，见 D-43）。
   * 所以服务器与摄像头的网卡口也要跟着设成对应 VLAN。
   */
  srv.ports = srv.ports.map((port) => (port.id === 'port-sfp-1' ? { ...port, vlan: 30 } : port));
  camera.ports = camera.ports.map((port) => (port.id === 'port-fe1' ? { ...port, vlan: 20 } : port));

  // 办公终端走 DHCP
  for (const host of [pc1, pc2, laptop, phone]) {
    host.client = { mode: 'dhcp', dns: [] };
  }
  // 访客笔记本按 802.11ac 接入（比办公 AP 的 ax 慢一档，便于演示协商取小）
  laptop.wireless = { mode: 'sta', ssid: 'TopoSmith-Office', band: '5G', standard: '802.11ac' };
  phone.wireless = { mode: 'sta', ssid: 'TopoSmith-Office', band: '5G', standard: '802.11ax' };

  const devices: Device[] = [
    cloud, olt, ont, router, rack, sw, srv, ap, pc1, pc2, printer, nas, camera, laptop, phone,
  ];

  const cables: Cable[] = [
    { id: 'cbl-backbone', type: 'lc-sm', lengthM: 1200, a: { deviceId: cloud.id, portId: 'port-sfp1' }, b: { deviceId: olt.id, portId: 'port-sfp1' } },
    { id: 'cbl-pon', type: 'lc-sm', lengthM: 400, a: { deviceId: olt.id, portId: 'port-pon1' }, b: { deviceId: ont.id, portId: 'port-pon1' } },
    { id: 'cbl-ont-rt', type: 'cat6', lengthM: 3, a: { deviceId: ont.id, portId: 'port-ge1' }, b: { deviceId: router.id, portId: 'port-wan1' } },
    // 路由器三个 LAN 口 → 交换机上同 VLAN 的上联口
    { id: 'cbl-rt-office', type: 'cat6', lengthM: 2, a: { deviceId: router.id, portId: 'port-ge2' }, b: { deviceId: sw.id, portId: 'port-ge24' } },
    { id: 'cbl-rt-guest', type: 'cat6', lengthM: 2, a: { deviceId: router.id, portId: 'port-ge3' }, b: { deviceId: sw.id, portId: 'port-ge23' } },
    { id: 'cbl-rt-srv', type: 'cat6', lengthM: 2, a: { deviceId: router.id, portId: 'port-ge4' }, b: { deviceId: sw.id, portId: 'port-ge22' } },
    // 办公段（VLAN 1）：AP 的无线口要并进这一段，所以整段必须待在 VLAN 1
    { id: 'cbl-sw-ap', type: 'cat6', lengthM: 30, a: { deviceId: sw.id, portId: 'port-ge2' }, b: { deviceId: ap.id, portId: 'port-ge1' } },
    { id: 'cbl-sw-nas', type: 'cat5e', lengthM: 8, a: { deviceId: sw.id, portId: 'port-ge3' }, b: { deviceId: nas.id, portId: 'port-2-5ge1' } },
    { id: 'cbl-sw-pc1', type: 'cat6', lengthM: 12, a: { deviceId: sw.id, portId: 'port-ge4' }, b: { deviceId: pc1.id, portId: 'port-ge1' } },
    { id: 'cbl-sw-pc2', type: 'cat6a', lengthM: 18, a: { deviceId: sw.id, portId: 'port-ge6' }, b: { deviceId: pc2.id, portId: 'port-ge1' } },
    { id: 'cbl-sw-printer', type: 'cat5e', lengthM: 6, a: { deviceId: sw.id, portId: 'port-ge5' }, b: { deviceId: printer.id, portId: 'port-ge1' } },
    // 访客段：摄像头（百兆口）—— 这一段的上联口就是那处配错，ping 它会得到 VLAN_MISMATCH
    { id: 'cbl-sw-camera', type: 'cat5e', lengthM: 40, a: { deviceId: sw.id, portId: 'port-ge8' }, b: { deviceId: camera.id, portId: 'port-fe1' } },
    // 服务器段：10G 光口到服务器
    { id: 'cbl-srv-sfp', type: 'dac', lengthM: 3, a: { deviceId: sw.id, portId: 'port-sfp-1' }, b: { deviceId: srv.id, portId: 'port-sfp-1' } },
    { id: 'cbl-wifi-laptop', type: 'wireless', lengthM: 0, a: { deviceId: ap.id, portId: 'port-wlan' }, b: { deviceId: laptop.id, portId: 'port-wlan' } },
    { id: 'cbl-wifi-phone', type: 'wireless', lengthM: 0, a: { deviceId: ap.id, portId: 'port-wlan' }, b: { deviceId: phone.id, portId: 'port-wlan' } },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-office',
    name: '小微企业办公网（VLAN 分段）',
    description:
      '光猫出口 + 企业路由器带三个 VLAN（办公 10 / 访客 20 / 服务器 30），接入交换机与业务服务器装在机柜里。' +
      '**打印机那一口故意留在 VLAN 1**：从办公电脑 ping 它会得到「两端不在同一广播域」，在端口详情里把 PVID 改回 10 即可修好。',
    devices,
    cables,
    updatedAt: new Date().toISOString(),
  };
}
