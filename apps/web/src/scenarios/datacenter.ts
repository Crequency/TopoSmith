/**
 * 预置场景：机房机柜（多 U 上架 + 背面端口 + 10G 骨干）
 *
 * 这个场景专门演示**机柜与端口布局**这件事：
 *   · 42U 机柜里装了 1 台 24 口交换机、3 台 4U 服务器，空 U 位留着；
 *   · 服务器的端口**全在背面**（`side: 'rear'`）—— 悬浮卡片会半透明并透出背面端口，
 *     也可以直接翻面；机柜翻转时柜内设备跟着翻；
 *   · 服务器的管理口是千兆、数据口是万兆：同一台机器上"两条腿速度不同"，
 *     带宽诊断会指认瓶颈到底是哪一段。
 *
 * 地址规划：
 *   公网          203.0.113.0/24    ISP 网关 .1、权威 DNS .10
 *   接入段        100.64.0.0/24      OLT .1、机房出口路由 WAN .20
 *   机房管理段    10.20.0.0/24       出口路由 .1、交换机 .2、服务器 .11–.13、NAS .20、终端 DHCP .100+
 *
 * 接入用**桥接光猫**：二层透传，机房路由器自己拿 ISP 段地址做 NAT ——
 * 与「光接入（桥接光猫）」预置场景讲的是同一件事，这里只是顺带复用。
 */

import { instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, type Cable, type Device, type Scenario } from '@toposmith/schema';

export function buildDatacenterScenario(): Scenario {
  const make = (key: string, id: string, name: string, x: number, y: number): Device =>
    instantiate(key, id, name, x, y);

  const cloud = make('cloud', 'dev-cloud', '云 / 互联网', 80, 40);
  const olt = make('olt', 'dev-olt', 'OLT 局端', 80, 200);
  const ont = make('ont-bridge', 'dev-ont', '专线光猫（桥接）', 80, 380);
  const router = make('router', 'dev-router', '机房出口路由器', 380, 380);
  const rack = make('rack-24u', 'dev-rack', 'A 列 42U 机柜', 460, 80);
  rack.rack = { heightU: 42, flipped: false };

  const sw = make('switch-24-1g', 'dev-sw', '柜内接入交换机', 0, 0);
  const srv1 = make('server-rack', 'dev-srv1', '应用服务器 01', 0, 0);
  const srv2 = make('server-rack', 'dev-srv2', '应用服务器 02', 0, 0);
  const srv3 = make('server-rack', 'dev-srv3', '备份服务器', 0, 0);
  const nas = make('nas', 'dev-nas', '存储 NAS', 1180, 300);
  const admin = make('pc-mini', 'dev-admin', '运维终端', 1180, 520);
  const laptop = make('pc-laptop', 'dev-laptop', '巡检笔记本', 1180, 660);

  // ── 上架：交换机 1–4U，三台服务器 5–16U，其余 U 位留空
  mount(sw, rack, 1);
  mount(srv1, rack, 5);
  mount(srv2, rack, 9);
  mount(srv3, rack, 13);

  // ── 云侧：ISP 网关 .1 + 权威 DNS .10（同一个端口上两个地址）
  cloud.l3.interfaces = [
    { id: 'l3-cloud-gw', portId: 'port-sfp1', ip: '203.0.113.1', prefix: 24 },
    { id: 'l3-cloud-dns', portId: 'port-sfp1', ip: '203.0.113.10', prefix: 24 },
  ];
  cloud.services.dns = {
    enabled: true,
    records: [
      { id: 'rec-www', name: 'www.example.com', ip: '203.0.113.10' },
      { id: 'rec-nas', name: 'nas.dc.example.com', ip: '10.20.0.20' },
    ],
    forwarders: [],
  };

  // ── OLT：ISP 侧汇聚（用户侧网关 100.64.0.1 + 公网上联）
  olt.l3.interfaces = [
    { id: 'l3-olt-pon', portId: 'port-pon1', ip: '100.64.0.1', prefix: 24 },
    { id: 'l3-olt-sfp', portId: 'port-sfp1', ip: '203.0.113.2', prefix: 24 },
  ];
  // 桥接光猫不带地址：二层透传，由机房路由器自己拿 ISP 段地址（D-17）

  // ── 出口路由：WAN 接光猫（ISP 段），LAN 是管理段，做 NAT / DHCP / DNS 转发
  router.l3.interfaces = [
    { id: 'l3-rt-wan', portId: 'port-wan1', ip: '100.64.0.20', prefix: 24 },
    // LAN 地址必须落在**真正接了线的那个口**（GE3 接柜内交换机）：
    // DHCP 服务器是按"面向客户端的那个端口"选路的，地址不在那个口上就找不到服务器
    { id: 'l3-rt-lan', portId: 'port-ge3', ip: '10.20.0.1', prefix: 24 },
  ];
  router.l3.defaultGateway = '100.64.0.1';
  router.services.nat = true;
  router.services.dhcp = {
    enabled: true,
    poolStart: '10.20.0.100',
    poolEnd: '10.20.0.120',
    gateway: '10.20.0.1',
    dns: ['10.20.0.1'],
  };
  router.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.10'] };

  // ── 柜内交换机：管理地址 + 万兆上联
  sw.l3.interfaces = [{ id: 'l3-sw', portId: 'port-ge1', ip: '10.20.0.2', prefix: 24 }];
  sw.l3.defaultGateway = '10.20.0.1';

  /*
   * 服务器：管理口千兆、数据口万兆。
   *
   * 地址挂在**数据口（SFP+）**上，所以诊断默认走的是万兆那条腿；
   * 备份服务器只有一根千兆网线（存储口没插），它的地址只能挂在 GE1 上 ——
   * 于是"同一网段里两台机器，一台万兆一台千兆"，带宽诊断会明确指出瓶颈在备份服务器那一段。
   */
  for (const [index, srv] of [srv1, srv2].entries()) {
    srv.l3.interfaces = [
      { id: `l3-${srv.id}-data`, portId: 'port-sfp-1', ip: `10.20.0.${11 + index}`, prefix: 24 },
    ];
    srv.l3.defaultGateway = '10.20.0.1';
    // 关掉 DHCP 客户端：机架服务器模板缺省是 dhcp，而**租约会覆盖 l3.interfaces**
    // （model.ts 里是 addresses.set 赋值）。要精确指定地址就必须先退出 DHCP。
    srv.client = { mode: 'static', dns: ['10.20.0.1'] };
  }
  srv3.l3.interfaces = [{ id: 'l3-srv3-mgmt', portId: 'port-ge1', ip: '10.20.0.13', prefix: 24 }];
  srv3.l3.defaultGateway = '10.20.0.1';
  srv3.client = { mode: 'static', dns: ['10.20.0.1'] };

  // NAS 与运维终端用 DHCP 更贴近机房实况（存储 NAS 固定地址）
  nas.client = { mode: 'static', ip: '10.20.0.20', prefix: 24, gateway: '10.20.0.1', dns: ['10.20.0.1'] };
  admin.client = { mode: 'dhcp', dns: [] };
  laptop.client = { mode: 'dhcp', dns: [] };

  const devices: Device[] = [
    cloud, olt, ont, router, rack, sw, srv1, srv2, srv3, nas, admin, laptop,
  ];

  const cables: Cable[] = [
    // 公网 → OLT → 桥接光猫 → 机房路由器（全程介质正确：光纤对光纤、铜缆对铜缆）
    { id: 'cbl-backbone', type: 'lc-sm', lengthM: 1500, a: { deviceId: cloud.id, portId: 'port-sfp1' }, b: { deviceId: olt.id, portId: 'port-sfp1' } },
    { id: 'cbl-pon', type: 'lc-sm', lengthM: 600, a: { deviceId: olt.id, portId: 'port-pon1' }, b: { deviceId: ont.id, portId: 'port-pon1' } },
    { id: 'cbl-ont-rt', type: 'cat6', lengthM: 3, a: { deviceId: ont.id, portId: 'port-ge1' }, b: { deviceId: router.id, portId: 'port-wan1' } },
    /*
     * 出口路由 → 柜内交换机：**千兆铜缆**。
     *
     * 这里刻意不走光纤：路由器与交换机之间用的是两个 RJ45 口，
     * 光纤插不进电口（会判介质不匹配、链路直接 down）。要万兆就得两端都用 SFP+。
     * 于是这个机房的"瓶颈"非常真实：机柜内服务器之间是万兆，出口只有千兆。
     */
    { id: 'cbl-rt-sw', type: 'cat6a', lengthM: 30, a: { deviceId: router.id, portId: 'port-ge3' }, b: { deviceId: sw.id, portId: 'port-ge2' } },
    // 交换机万兆上联 → 三台服务器的数据口（DAC 直连）
    { id: 'cbl-sw-srv1', type: 'dac', lengthM: 2, a: { deviceId: sw.id, portId: 'port-sfp-1' }, b: { deviceId: srv1.id, portId: 'port-sfp-1' } },
    { id: 'cbl-sw-srv2', type: 'dac', lengthM: 2, a: { deviceId: sw.id, portId: 'port-sfp-2' }, b: { deviceId: srv2.id, portId: 'port-sfp-1' } },
    // 备份服务器只有千兆管理口接线（存储口没插 —— 带宽诊断会指认这条 1G 路径）
    { id: 'cbl-sw-srv3', type: 'cat6a', lengthM: 3, a: { deviceId: sw.id, portId: 'port-ge3' }, b: { deviceId: srv3.id, portId: 'port-ge1' } },
    // 带外管理口也各接一根（没有配地址，只是把"这块口用上了"画出来）
    { id: 'cbl-sw-srv1-mgmt', type: 'cat5e', lengthM: 3, a: { deviceId: sw.id, portId: 'port-ge4' }, b: { deviceId: srv1.id, portId: 'port-ge1' } },
    { id: 'cbl-sw-srv2-mgmt', type: 'cat5e', lengthM: 3, a: { deviceId: sw.id, portId: 'port-ge5' }, b: { deviceId: srv2.id, portId: 'port-ge1' } },
    // 柜外设备：NAS（2.5G）、运维终端、巡检笔记本
    { id: 'cbl-sw-nas', type: 'cat6', lengthM: 8, a: { deviceId: sw.id, portId: 'port-ge6' }, b: { deviceId: nas.id, portId: 'port-2-5ge1' } },
    { id: 'cbl-sw-admin', type: 'cat6', lengthM: 12, a: { deviceId: sw.id, portId: 'port-ge7' }, b: { deviceId: admin.id, portId: 'port-2-5ge1' } },
    { id: 'cbl-sw-laptop', type: 'cat5e', lengthM: 15, a: { deviceId: sw.id, portId: 'port-ge8' }, b: { deviceId: laptop.id, portId: 'port-ge1' } },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-datacenter',
    name: '机房机柜（42U·多 U 上架·背面端口）',
    description:
      '42U 机柜里装了 24 口交换机与三台 4U 服务器，空 U 位留着；服务器端口全在背面，' +
      '悬浮即可透视、也可以翻面查看。两台应用服务器之间走万兆（DAC），' +
      '备份服务器与**出口**只有千兆 —— 带宽诊断会指出瓶颈具体在哪一段。',
    devices,
    cables,
    updatedAt: new Date().toISOString(),
  };
}

/** 上架：U 位从 1 开始，位置由机柜几何算出（与 UI 的拖放结果一致） */
function mount(device: Device, rack: Device, startU: number): void {
  device.mount = { rackId: rack.id, startU };
  const units = device.rackUnits ?? 4;
  device.x = rack.x + 30;
  device.y = rack.y + 32 + 12 + (startU - 1) * 23 + Math.max(0, (units - 4) * 23) / 2;
}
