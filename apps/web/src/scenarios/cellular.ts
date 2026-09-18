/**
 * 预置场景：蜂窝网络（4G / 5G + 定向覆盖）
 *
 * 这个场景演示的是**覆盖即关联**（D-57）：
 *   · 4G 基站一台，全向 40 m（城区微站口径），两台手机在圈内正常接入；
 *   · 5G 基站两台，都用**定向扇形**：A 朝向正右（120°），B 朝向正下（90°）。
 *     B 的那台手机刻意放在"半径内、扇形外"—— 距离够近但方向不对，
 *     链路必须断，报文里会说明是角度不满足；
 *   · 一台 5G CPE 用无线口关联 5G 基站当上行，用自己的 LAN 口带一台台式机；
 *   · 一台平板跑出所有覆盖圈（断），一台只有 WiFi 的笔记本接在 4G 基站上（制式不匹配，也断）。
 *
 * 简化点（写在明处）：核心网被简化成"一台核心路由器 + 二层桥接的基站"——
 * 基站把空口与回传口桥在一起，于是蜂窝终端与回传段在同一个广播域里拿地址。
 * 真实的蜂窝是隧道 + 独立的会话管理，那是 M2 之后的事（docs/05-engine.md §6）。
 *
 * 地址规划：
 *   公网      203.0.113.0/24   云网关 .1（兼权威 DNS）、核心路由器 WAN .20
 *   回传段    10.10.0.0/24     核心路由器 .1（NAT/DHCP/DNS）、汇聚 .2、接入 .3
 *   蜂窝终端  10.10.0.100+     由核心路由器分配（与回传段同广播域）
 *   CPE 内网  192.168.8.0/24   CPE .1、台式机 .10
 */

import { instantiate } from '@toposmith/catalog';
import {
  SCHEMA_VERSION,
  omniCoverage,
  sectorCoverage,
  type Cable,
  type Device,
  type Scenario,
} from '@toposmith/schema';

export function buildCellularScenario(): Scenario {
  const make = (key: string, id: string, name: string, x: number, y: number): Device =>
    instantiate(key, id, name, x, y);

  const cloud = make('cloud', 'dev-cloud', '云 / 互联网', 60, 40);
  const core = make('router', 'dev-core', '核心路由器（蜂窝核心）', 60, 260);
  const swAgg = make('switch-5-2.5g', 'dev-sw-agg', '回传汇聚交换机', 480, 200);
  const swAcc = make('switch-5-2.5g', 'dev-sw-acc', '回传接入交换机', 480, 760);

  const bs4g = make('bs-4g', 'dev-bs-4g', '4G 基站（全向 40 m）', 1200, 1600);
  const bs5a = make('bs-5g', 'dev-bs-5g-a', '5G 基站 A（定向 120°→右）', 2000, 300);
  const bs5b = make('bs-5g', 'dev-bs-5g-b', '5G 基站 B（定向 90°→下）', 2000, 1400);

  const phone4gA = make('mobile-phone', 'dev-phone-4g-a', '4G 手机 A', 1500, 1750);
  const phone4gB = make('mobile-phone', 'dev-phone-4g-b', '4G 手机 B', 900, 1300);
  const phone5g = make('mobile-phone', 'dev-phone-5g', '5G 手机', 2500, 300);
  const phone5gIn = make('mobile-phone', 'dev-phone-5g-in', '5G 手机（扇区内）', 2000, 2000);
  const phone5gOff = make('mobile-phone', 'dev-phone-5g-off', '5G 手机（扇区外）', 2000, 900);
  const tabletOut = make('pc-tablet', 'dev-tablet-out', '跑出覆盖的平板', 3400, 1600);
  const laptopWifi = make('pc-laptop', 'dev-laptop-wifi', '只有 WiFi 的笔记本', 1000, 1950);
  const cpe = make('cpe-5g', 'dev-cpe', '5G CPE', 2800, 700);
  const pc = make('pc-desktop', 'dev-pc', 'CPE 下的台式机', 3100, 700);

  // ── 核心网侧：公网出口 + NAT/DHCP/DNS
  cloud.l3.interfaces = [{ id: 'l3-cloud', portId: 'port-sfp1', ip: '203.0.113.1', prefix: 24 }];
  cloud.services.dns = {
    enabled: true,
    records: [
      { id: 'rec-www', name: 'www.example.com', ip: '203.0.113.1' },
      { id: 'rec-speed', name: 'speed.example.com', ip: '203.0.113.1' },
    ],
    forwarders: [],
  };

  core.l3.interfaces = [
    { id: 'l3-core-wan', portId: 'port-sfp-1', ip: '203.0.113.20', prefix: 24 },
    { id: 'l3-core-lan', portId: 'port-ge2', ip: '10.10.0.1', prefix: 24 },
  ];
  core.l3.defaultGateway = '203.0.113.1';
  core.services.nat = true;
  core.services.dhcp = {
    enabled: true,
    poolStart: '10.10.0.100',
    poolEnd: '10.10.0.160',
    gateway: '10.10.0.1',
    dns: ['10.10.0.1'],
  };
  core.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.1'] };
  swAgg.l3.interfaces = [{ id: 'l3-agg', portId: 'port-ge1', ip: '10.10.0.2', prefix: 24 }];
  swAcc.l3.interfaces = [{ id: 'l3-acc', portId: 'port-ge1', ip: '10.10.0.3', prefix: 24 }];
  swAgg.l3.defaultGateway = '10.10.0.1';
  swAcc.l3.defaultGateway = '10.10.0.1';

  // ── 基站的覆盖：4G 全向、5G 两台都用定向（扇区），朝向与半径各不相同
  bs4g.wireless = { ...(bs4g.wireless ?? { mode: 'ap' as const }), coverage: omniCoverage(40) };
  bs5a.wireless = { ...(bs5a.wireless ?? { mode: 'ap' as const }), coverage: sectorCoverage(70, 120, 0) };
  bs5b.wireless = { ...(bs5b.wireless ?? { mode: 'ap' as const }), coverage: sectorCoverage(50, 90, 90) };

  // ── 终端：蜂窝终端只有 PLMN，没有 SSID
  const cellular = [
    [phone4gA, 'lte'],
    [phone4gB, 'lte'],
    [phone5g, 'nr'],
    [phone5gIn, 'nr'],
    [phone5gOff, 'nr'],
    [tabletOut, 'nr'],
  ] as const;
  for (const [device, standard] of cellular) {
    device.wireless = { mode: 'sta', standard, plmn: '46000' };
    device.client = { mode: 'dhcp', dns: [] };
  }
  // 跑出覆盖的平板给静态地址：这样"不通"确实是关联不成立，而不是没拿到地址
  tabletOut.client = { mode: 'static', ip: '10.10.0.222', prefix: 24, gateway: '10.10.0.1', dns: ['10.10.0.1'] };
  // 笔记本只有 WiFi：它与 4G 基站的关联会因为制式不同而不成立
  laptopWifi.wireless = { mode: 'sta', ssid: 'IDC-Ops', band: '5G', standard: '802.11ax' };
  laptopWifi.client = { mode: 'dhcp', dns: [] };

  // ── CPE：无线口关联 5G 基站当上行（DHCP 从核心网拿地址），LAN 侧自己 NAT
  cpe.client = { mode: 'static', dns: ['10.10.0.1'] };
  cpe.l3.interfaces = [
    // WAN 侧：运营商的蜂窝段地址（静态开通）；LAN 侧：自己的内网网关
    { id: 'l3-cpe-wan', portId: 'port-5g-nr', ip: '10.10.0.120', prefix: 24 },
    { id: 'l3-cpe-lan', portId: 'port-ge1', ip: '192.168.8.1', prefix: 24 },
  ];
  cpe.l3.defaultGateway = '10.10.0.1';
  cpe.services.nat = true;
  cpe.services.dhcp = {
    enabled: true,
    poolStart: '192.168.8.100',
    poolEnd: '192.168.8.150',
    gateway: '192.168.8.1',
    dns: ['192.168.8.1'],
  };
  cpe.services.dns = { enabled: true, records: [], forwarders: [] };
  pc.client = { mode: 'static', ip: '192.168.8.10', prefix: 24, gateway: '192.168.8.1', dns: ['192.168.8.1'] };

  const devices: Device[] = [
    cloud, core, swAgg, swAcc,
    bs4g, bs5a, bs5b,
    phone4gA, phone4gB, phone5g, phone5gIn, phone5gOff, tabletOut, laptopWifi,
    cpe, pc,
  ];

  const cables: Cable[] = [
    // 公网 → 核心路由器；核心 → 汇聚 → 接入：三层回传网
    { id: 'cbl-backbone', type: 'lc-sm', lengthM: 5000, a: { deviceId: cloud.id, portId: 'port-sfp1' }, b: { deviceId: core.id, portId: 'port-sfp-1' } },
    { id: 'cbl-core-agg', type: 'cat6a', lengthM: 40, a: { deviceId: core.id, portId: 'port-ge2' }, b: { deviceId: swAgg.id, portId: 'port-ge1' } },
    { id: 'cbl-agg-acc', type: 'lc-sm', lengthM: 600, a: { deviceId: swAgg.id, portId: 'port-sfp-1' }, b: { deviceId: swAcc.id, portId: 'port-sfp-1' } },
    // 基站回传：城域网光纤
    { id: 'cbl-agg-bs5a', type: 'lc-sm', lengthM: 900, a: { deviceId: swAgg.id, portId: 'port-sfp-2' }, b: { deviceId: bs5a.id, portId: 'port-sfp-1' } },
    // 4G 微站走电口回传（城域接入常见），接入交换机剩下的 SFP+ 留给 5G 站
    { id: 'cbl-acc-bs4g', type: 'cat6a', lengthM: 80, a: { deviceId: swAcc.id, portId: 'port-ge2' }, b: { deviceId: bs4g.id, portId: 'port-ge1' } },
    { id: 'cbl-acc-bs5b', type: 'lc-sm', lengthM: 800, a: { deviceId: swAcc.id, portId: 'port-sfp-2' }, b: { deviceId: bs5b.id, portId: 'port-sfp-1' } },
    // CPE 室内侧：有线接台式机
    { id: 'cbl-cpe-pc', type: 'cat6', lengthM: 5, a: { deviceId: cpe.id, portId: 'port-ge1' }, b: { deviceId: pc.id, portId: 'port-ge1' } },
    // 蜂窝关联：成立的四条
    { id: 'cbl-nr-a-phone', type: 'wireless', lengthM: 0, a: { deviceId: bs5a.id, portId: 'port-wlan' }, b: { deviceId: phone5g.id, portId: 'port-wlan' } },
    { id: 'cbl-nr-a-cpe', type: 'wireless', lengthM: 0, a: { deviceId: bs5a.id, portId: 'port-wlan' }, b: { deviceId: cpe.id, portId: 'port-5g-nr' } },
    { id: 'cbl-nr-b-phone', type: 'wireless', lengthM: 0, a: { deviceId: bs5b.id, portId: 'port-wlan' }, b: { deviceId: phone5gIn.id, portId: 'port-wlan' } },
    { id: 'cbl-lte-phone-a', type: 'wireless', lengthM: 0, a: { deviceId: bs4g.id, portId: 'port-wlan' }, b: { deviceId: phone4gA.id, portId: 'port-wlan' } },
    { id: 'cbl-lte-phone-b', type: 'wireless', lengthM: 0, a: { deviceId: bs4g.id, portId: 'port-wlan' }, b: { deviceId: phone4gB.id, portId: 'port-wlan' } },
    // 刻意不成立的三条：方向不对 / 跑出覆盖 / 制式不对
    { id: 'cbl-nr-b-off', type: 'wireless', lengthM: 0, a: { deviceId: bs5b.id, portId: 'port-wlan' }, b: { deviceId: phone5gOff.id, portId: 'port-wlan' } },
    { id: 'cbl-nr-a-out', type: 'wireless', lengthM: 0, a: { deviceId: bs5a.id, portId: 'port-wlan' }, b: { deviceId: tabletOut.id, portId: 'port-wlan' } },
    { id: 'cbl-lte-wifi', type: 'wireless', lengthM: 0, a: { deviceId: bs4g.id, portId: 'port-wlan' }, b: { deviceId: laptopWifi.id, portId: 'port-wlan' } },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-cellular',
    name: '蜂窝网络（4G/5G + 定向覆盖）',
    description:
      '一台 4G 基站（全向 40 m）+ 两台 5G 基站（定向扇形），终端与基站之间的关联由**覆盖范围**判定：' +
      '在圈内、在扇形朝向内才成立。一台手机刻意放在"距离够近但方向不对"的位置，一台平板跑出了所有覆盖圈，' +
      '一台只有 WiFi 的笔记本接在基站上 —— 三条关联都会断，报错各自不同。' +
      '另有一台 5G CPE 用无线口做上行、LAN 口带一台台式机（无线宽带 FWA）。',
    devices,
    cables,
    updatedAt: new Date().toISOString(),
  };
}
