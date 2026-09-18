/**
 * 预置场景：家庭网络（光猫路由模式 + NAT + AP）
 *
 * 这个场景不是装饰，它是产品的**自带冒烟测试**：没有公网侧目标，
 * "NAT 转换点"与"DNS 转发链"两个核心演示都跑不起来（docs/06-addressing.md §6）。
 *
 * 地址规划：
 *   云侧 / 公网      203.0.113.0/24（TEST-NET-3，文档专用段）  云 .10、OLT 上联 .1
 *   接入段（PON）    100.64.0.0/24（CGNAT 段）                 OLT .1、光猫 WAN .10
 *   家庭 LAN        192.168.1.0/24                            光猫 .1、交换机 .2、AP .3、终端 .100+
 */

import { instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, type Cable, type Device, type Scenario } from '@toposmith/schema';

function make(key: string, id: string, name: string, x: number, y: number): Device {
  return instantiate(key, id, name, x, y);
}

export function buildHomeScenario(): Scenario {
  const cloud = make('cloud', 'dev-cloud', '云 / 互联网', 60, 40);
  const olt = make('olt', 'dev-olt', 'OLT 局端', 60, 210);
  const ont = make('ont', 'dev-ont', '客厅光猫', 60, 380);
  const sw = make('switch-5-2.5g', 'dev-sw', '书房交换机', 380, 380);
  const ap = make('ap', 'dev-ap', '客厅 AP', 380, 580);
  const pc = make('pc-desktop', 'dev-pc', '书房台式机', 720, 190);
  const nas = make('nas', 'dev-nas', 'NAS', 720, 300);
  const srv = make('server-rack', 'dev-srv', '机架服务器', 720, 410);
  const laptop = make('pc-laptop', 'dev-laptop', '笔记本', 720, 540);
  const phone = make('mobile-phone', 'dev-phone', '手机', 720, 650);

  // ── 云侧：托管权威 DNS 与示例站点
  cloud.l3.interfaces = [
    { id: 'l3-cloud-1', portId: 'port-sfp1', ip: '203.0.113.10', prefix: 24 },
  ];
  cloud.services.dns = {
    enabled: true,
    records: [
      { id: 'rec-www', name: 'www.example.com', ip: '203.0.113.10' },
      { id: 'rec-home', name: 'home.example.com', ip: '203.0.113.10' },
    ],
    forwarders: [],
  };

  // ── OLT：用户侧网关（100.64.0.1）+ 公网上联（203.0.113.1）
  olt.l3.interfaces = [
    { id: 'l3-olt-pon', portId: 'port-pon1', ip: '100.64.0.1', prefix: 24 },
    { id: 'l3-olt-sfp', portId: 'port-sfp1', ip: '203.0.113.1', prefix: 24 },
  ];

  // ── 光猫（路由模式）：WAN + LAN + NAT + DHCP + DNS 转发
  ont.l3.interfaces = [
    { id: 'l3-ont-wan', portId: 'port-pon1', ip: '100.64.0.10', prefix: 24 },
    { id: 'l3-ont-lan', portId: 'port-ge1', ip: '192.168.1.1', prefix: 24 },
  ];
  ont.l3.defaultGateway = '100.64.0.1';
  ont.services.nat = true;
  ont.services.dhcp = {
    enabled: true,
    poolStart: '192.168.1.100',
    poolEnd: '192.168.1.200',
    gateway: '192.168.1.1',
    dns: ['192.168.1.1'],
  };
  ont.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.10'] };

  // ── 交换机与 AP 的管理地址（便于从任意终端 ping 它们）
  sw.l3.interfaces = [{ id: 'l3-sw', portId: 'port-ge1', ip: '192.168.1.2', prefix: 24 }];
  ap.l3.interfaces = [{ id: 'l3-ap', portId: 'port-ge1', ip: '192.168.1.3', prefix: 24 }];
  // SSID 必须与终端一致，否则无线关联会被判为 SSID_MISMATCH（D-18）
  ap.wireless = {
    // 展开模板里的无线配置：覆盖范围（30 m 全向）一起留着
    ...ap.wireless,
    mode: 'ap',
    ssid: 'TopoSmith-Home',
    band: '5G',
    standard: '802.11ax',
    channel: 149,
  };

  const devices: Device[] = [cloud, olt, ont, sw, ap, pc, nas, srv, laptop, phone];

  const cables: Cable[] = [
    // 公网上联：单模光纤
    {
      id: 'cbl-backbone',
      type: 'lc-sm',
      lengthM: 1000,
      a: { deviceId: cloud.id, portId: 'port-sfp1' },
      b: { deviceId: olt.id, portId: 'port-sfp1' },
    },
    // PON 接入：光猫到局端
    {
      id: 'cbl-pon',
      type: 'lc-sm',
      lengthM: 500,
      a: { deviceId: olt.id, portId: 'port-pon1' },
      b: { deviceId: ont.id, portId: 'port-pon1' },
    },
    // 家庭有线：光猫 → 交换机 → 各终端
    {
      id: 'cbl-ont-sw',
      type: 'cat6',
      lengthM: 5,
      a: { deviceId: ont.id, portId: 'port-ge1' },
      b: { deviceId: sw.id, portId: 'port-ge1' },
    },
    {
      id: 'cbl-sw-pc',
      type: 'cat6a',
      lengthM: 15,
      a: { deviceId: sw.id, portId: 'port-ge2' },
      b: { deviceId: pc.id, portId: 'port-ge1' },
    },
    {
      id: 'cbl-sw-nas',
      type: 'cat5e',
      lengthM: 10,
      a: { deviceId: sw.id, portId: 'port-ge3' },
      b: { deviceId: nas.id, portId: 'port-2-5ge1' },
    },
    {
      id: 'cbl-sw-ap',
      type: 'cat6',
      lengthM: 25,
      a: { deviceId: sw.id, portId: 'port-ge4' },
      b: { deviceId: ap.id, portId: 'port-ge1' },
    },
    {
      id: 'cbl-sw-srv',
      type: 'cat6a',
      lengthM: 20,
      a: { deviceId: sw.id, portId: 'port-ge5' },
      b: { deviceId: srv.id, portId: 'port-ge1' },
    },
    // 无线关联：一个 AP 的 radio 承载多台客户端（D-11 例外）
    {
      id: 'cbl-wifi-laptop',
      type: 'wireless',
      lengthM: 0,
      a: { deviceId: ap.id, portId: 'port-wlan' },
      b: { deviceId: laptop.id, portId: 'port-wlan' },
    },
    {
      id: 'cbl-wifi-phone',
      type: 'wireless',
      lengthM: 0,
      a: { deviceId: ap.id, portId: 'port-wlan' },
      b: { deviceId: phone.id, portId: 'port-wlan' },
    },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-home',
    name: '家庭网络（光猫路由 + AP）',
    description:
      '光猫路由模式下做 NAT 与 DHCP，交换机接有线终端，AP 提供无线，上行经 OLT 到云侧。开箱即可跑通四类诊断。',
    devices,
    cables,
    updatedAt: new Date().toISOString(),
  };
}

/** 空场景：用户从零开始画 */
export function buildEmptyScenario(): Scenario {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-empty',
    name: '空白拓扑',
    description: '从左侧设备面板拖入设备开始绘制。',
    devices: [],
    cables: [],
    updatedAt: new Date().toISOString(),
  };
}
