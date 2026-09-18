/**
 * 预置场景：园区无线覆盖（多 AP 同 SSID + 一处 SSID 配错）
 *
 * 三台 AP 挂在同一台接入交换机上，SSID 都是 `Campus`，但频段/标准不同：
 *   2.4G 802.11n（老设备）、5G 802.11ac（主流）、6G 802.11be（新设备）。
 * 终端与 AP 之间按各自的 802.11 标准协商，**取两端较小值** ——
 * 同一个 AP 下，"老手机 300 Mbps"和"新平板 2.4 Gbps"会同时出现在画布上。
 *
 * 另外有一台平板**配错了 SSID**（`Campus-2G`）：它那条无线链路起不来，
 * 从有线 PC ping 它会明确报出 SSID 不一致 —— 无线排查最常见的一类问题。
 *
 * 地址规划：
 *   公网    203.0.113.0/24   ISP 网关 .1、权威 DNS .10
 *   接入段  100.64.0.0/24    OLT .1、专线光猫（桥接）透传、校园出口 WAN .20
 *   校园网  172.16.0.0/24    出口路由 .1、AP .11–.13、有线终端 .20、DHCP .100+
 */

import { instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, type Cable, type Device, type Scenario } from '@toposmith/schema';

export function buildCampusScenario(): Scenario {
  const make = (key: string, id: string, name: string, x: number, y: number): Device =>
    instantiate(key, id, name, x, y);

  const cloud = make('cloud', 'dev-cloud', '云 / 互联网', 60, 40);
  const olt = make('olt', 'dev-olt', 'OLT 局端', 60, 200);
  const ont = make('ont-bridge', 'dev-ont', '专线光猫（桥接）', 60, 360);
  const router = make('router', 'dev-router', '校园出口路由器', 340, 500);
  const sw = make('switch-24-1g', 'dev-sw', '接入交换机', 660, 500);

  const apN = make('ap', 'dev-ap-n', 'AP-1（2.4G n）', 1020, 200);
  const apAc = make('ap', 'dev-ap-ac', 'AP-2（5G ac）', 1020, 400);
  const apBe = make('ap', 'dev-ap-be', 'AP-3（6G be）', 1020, 600);

  const pc = make('pc-desktop', 'dev-pc', '机房有线 PC', 1020, 800);
  const phone = make('mobile-phone', 'dev-phone', '学生手机', 1400, 200);
  const laptop = make('pc-laptop', 'dev-laptop', '教师笔记本', 1400, 400);
  const tablet = make('pc-tablet', 'dev-tablet', '新平板', 1400, 600);
  const tabletBad = make('pc-tablet', 'dev-tablet-bad', '配错 SSID 的平板', 1400, 800);

  // ── 云侧 / ISP
  cloud.l3.interfaces = [
    { id: 'l3-cloud-gw', portId: 'port-sfp1', ip: '203.0.113.1', prefix: 24 },
    { id: 'l3-cloud-dns', portId: 'port-sfp1', ip: '203.0.113.10', prefix: 24 },
  ];
  cloud.services.dns = {
    enabled: true,
    records: [
      { id: 'rec-portal', name: 'portal.example.com', ip: '172.16.0.20' },
      { id: 'rec-www', name: 'www.example.com', ip: '203.0.113.10' },
    ],
    forwarders: [],
  };
  olt.l3.interfaces = [
    { id: 'l3-olt-pon', portId: 'port-pon1', ip: '100.64.0.1', prefix: 24 },
    { id: 'l3-olt-sfp', portId: 'port-sfp1', ip: '203.0.113.2', prefix: 24 },
  ];
  // 桥接光猫：二层透传，校园出口路由器自己拿 ISP 段地址

  // ── 校园出口路由器：NAT + DHCP + DNS 转发
  router.l3.interfaces = [
    { id: 'l3-rt-wan', portId: 'port-wan1', ip: '100.64.0.20', prefix: 24 },
    { id: 'l3-rt-lan', portId: 'port-ge2', ip: '172.16.0.1', prefix: 24 },
  ];
  router.l3.defaultGateway = '100.64.0.1';
  router.services.nat = true;
  router.services.dhcp = {
    enabled: true,
    poolStart: '172.16.0.100',
    poolEnd: '172.16.0.160',
    gateway: '172.16.0.1',
    dns: ['172.16.0.1'],
  };
  router.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.10'] };

  // ── 三台 AP：同 SSID、不同频段与标准；管理地址固定
  const aps: [Device, string, '2.4G' | '5G' | '6G', '802.11n' | '802.11ac' | '802.11be', number][] = [
    [apN, '172.16.0.11', '2.4G', '802.11n', 6],
    [apAc, '172.16.0.12', '5G', '802.11ac', 44],
    [apBe, '172.16.0.13', '6G', '802.11be', 37],
  ];
  aps.forEach(([ap, ip, band, standard, channel], index) => {
    ap.l3.interfaces = [{ id: `l3-${ap.id}`, portId: 'port-ge1', ip, prefix: 24 }];
    ap.l3.defaultGateway = '172.16.0.1';
    // 展开模板里的无线配置：园区 AP 的缺省覆盖（30 m 全向）继续有效
    ap.wireless = { ...ap.wireless, mode: 'ap', ssid: 'Campus', band, standard, channel };
    // 交换机 1 口留给出入口，AP 从 2 口开始
    void index;
  });

  // ── 终端：无线关联到各自标准的 AP
  phone.wireless = { mode: 'sta', ssid: 'Campus', band: '2.4G', standard: '802.11n' };
  laptop.wireless = { mode: 'sta', ssid: 'Campus', band: '5G', standard: '802.11ax' };
  tablet.wireless = { mode: 'sta', ssid: 'Campus', band: '6G', standard: '802.11be' };
  // 这一台配错了 SSID：链路起不来（诊断会报 SSID 不一致）
  tabletBad.wireless = { mode: 'sta', ssid: 'Campus-2G', band: '5G', standard: '802.11ac' };
  for (const host of [pc, phone, laptop, tablet, tabletBad]) {
    host.client = { mode: 'dhcp', dns: [] };
  }
  // 配错 SSID 的那台给固定地址，这样"ping 不通"才是链路问题而不是没地址
  tabletBad.client = { mode: 'static', ip: '172.16.0.200', prefix: 24, gateway: '172.16.0.1', dns: ['172.16.0.1'] };
  pc.client = { mode: 'static', ip: '172.16.0.20', prefix: 24, gateway: '172.16.0.1', dns: ['172.16.0.1'] };

  const devices: Device[] = [
    cloud, olt, ont, router, sw, apN, apAc, apBe, pc, phone, laptop, tablet, tabletBad,
  ];

  const cables: Cable[] = [
    { id: 'cbl-backbone', type: 'lc-sm', lengthM: 1500, a: { deviceId: cloud.id, portId: 'port-sfp1' }, b: { deviceId: olt.id, portId: 'port-sfp1' } },
    { id: 'cbl-pon', type: 'lc-sm', lengthM: 700, a: { deviceId: olt.id, portId: 'port-pon1' }, b: { deviceId: ont.id, portId: 'port-pon1' } },
    { id: 'cbl-ont-rt', type: 'cat6', lengthM: 3, a: { deviceId: ont.id, portId: 'port-ge1' }, b: { deviceId: router.id, portId: 'port-wan1' } },
    { id: 'cbl-rt-sw', type: 'cat6a', lengthM: 20, a: { deviceId: router.id, portId: 'port-ge2' }, b: { deviceId: sw.id, portId: 'port-ge1' } },
    // 三台 AP 用 PoE 网线挂到交换机（AP 上行口是 2.5G）
    { id: 'cbl-sw-apn', type: 'cat6', lengthM: 35, a: { deviceId: sw.id, portId: 'port-ge2' }, b: { deviceId: apN.id, portId: 'port-ge1' } },
    { id: 'cbl-sw-apac', type: 'cat6', lengthM: 40, a: { deviceId: sw.id, portId: 'port-ge3' }, b: { deviceId: apAc.id, portId: 'port-ge1' } },
    { id: 'cbl-sw-apbe', type: 'cat6a', lengthM: 45, a: { deviceId: sw.id, portId: 'port-ge4' }, b: { deviceId: apBe.id, portId: 'port-ge1' } },
    { id: 'cbl-sw-pc', type: 'cat6', lengthM: 15, a: { deviceId: sw.id, portId: 'port-ge5' }, b: { deviceId: pc.id, portId: 'port-ge1' } },
    // 无线关联：SSID 与频段都要对得上，链路才算 up
    { id: 'cbl-wifi-phone', type: 'wireless', lengthM: 0, a: { deviceId: apN.id, portId: 'port-wlan' }, b: { deviceId: phone.id, portId: 'port-wlan' } },
    { id: 'cbl-wifi-laptop', type: 'wireless', lengthM: 0, a: { deviceId: apAc.id, portId: 'port-wlan' }, b: { deviceId: laptop.id, portId: 'port-wlan' } },
    { id: 'cbl-wifi-tablet', type: 'wireless', lengthM: 0, a: { deviceId: apBe.id, portId: 'port-wlan' }, b: { deviceId: tablet.id, portId: 'port-wlan' } },
    { id: 'cbl-wifi-tablet-bad', type: 'wireless', lengthM: 0, a: { deviceId: apAc.id, portId: 'port-wlan' }, b: { deviceId: tabletBad.id, portId: 'port-wlan' } },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-campus',
    name: '园区无线覆盖（多 AP·SSID 排查）',
    description:
      '三台 AP 同 SSID、频段与标准各不相同（2.4G n / 5G ac / 6G be），终端按两端较小值协商速率；' +
      '另有一台平板**配错了 SSID**（Campus-2G），它的无线链路起不来 —— ' +
      '从有线 PC ping 它会明确报出 SSID 不一致，改回 Campus 即可。',
    devices,
    cables,
    updatedAt: new Date().toISOString(),
  };
}
