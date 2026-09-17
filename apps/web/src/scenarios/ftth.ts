/**
 * 预置场景：光接入（同一 OLT 下的两种光猫接法）
 *
 * 一个 PON 口带一个 ONU，所以两个用户各占一个 PON 口：
 *   · A 户用**桥接光猫 + 自己的路由器**（路由器拿 ISP 段地址做 NAT/DHCP/DNS）；
 *   · B 户用**路由模式光猫**（光猫自己 NAT，路由器只在后面当交换机用不上）。
 * 这两条支路在同一个画布里对照，正好演示 D-17 说的"桥接 / 路由都成立"。
 *
 * B 户的光猫 PON 口是 **EPON 1G** 而 OLT 侧是 10G-EPON：链路会按 1G 协商，
 * 带宽诊断会明确写出"按较低速率协商"—— 想改成万兆，在端口详情里改端口速率即可。
 *
 * 地址规划：
 *   公网        203.0.113.0/24    ISP 网关 .1、权威 DNS .10
 *   接入段      100.64.0.0/24     OLT .1、A 户 WAN .20、B 户光猫 WAN .30
 *   A 户内网    192.168.1.0/24    路由器 .1、DHCP .100+
 *   B 户内网    192.168.2.0/24    光猫 .1、DHCP .100+
 */

import { instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, type Cable, type Device, type Scenario } from '@toposmith/schema';

export function buildFtthScenario(): Scenario {
  const make = (key: string, id: string, name: string, x: number, y: number): Device =>
    instantiate(key, id, name, x, y);

  const cloud = make('cloud', 'dev-cloud', '云 / 互联网', 60, 40);
  const olt = make('olt', 'dev-olt', 'OLT 局端', 60, 220);
  // A 户：桥接光猫 + 自备路由器
  const ontA = make('ont-bridge', 'dev-ont-a', 'A 户光猫（桥接）', 60, 420);
  const routerA = make('router', 'dev-router-a', 'A 户路由器', 380, 420);
  const pcA = make('pc-desktop', 'dev-pc-a', 'A 户台式机', 760, 300);
  const lapA = make('pc-laptop', 'dev-lap-a', 'A 户笔记本', 760, 430);
  const phA = make('mobile-phone', 'dev-phone-a', 'A 户手机', 760, 560);
  // B 户：路由模式光猫一台搞定
  const ontB = make('ont', 'dev-ont-b', 'B 户光猫（路由）', 60, 700);
  const pcB = make('pc-desktop', 'dev-pc-b', 'B 户台式机', 760, 700);
  const phB = make('mobile-phone', 'dev-phone-b', 'B 户手机', 760, 830);

  // ── 云侧：ISP 网关 + 权威 DNS
  cloud.l3.interfaces = [
    { id: 'l3-cloud-gw', portId: 'port-sfp1', ip: '203.0.113.1', prefix: 24 },
    { id: 'l3-cloud-dns', portId: 'port-sfp1', ip: '203.0.113.10', prefix: 24 },
  ];
  cloud.services.dns = {
    enabled: true,
    records: [{ id: 'rec-www', name: 'www.example.com', ip: '203.0.113.10' }],
    forwarders: [],
  };

  /*
   * OLT：两个 PON 口各带一个 ONU，**每个 PON 口有自己的网关地址**。
   *
   * 地址必须挂在"那个用户实际连的口"上：ARP 解析是**按广播域**找持有该 IP 的**端口**，
   * 把 A 户的网关地址挂在 PON1 上，B 户（接在 PON2）就永远解析不到它。
   * 真实网络里同一台 OLT 的不同 PON 口本来就各有各的网关地址。
   */
  olt.l3.interfaces = [
    { id: 'l3-olt-pon1', portId: 'port-pon1', ip: '100.64.0.1', prefix: 24 },
    { id: 'l3-olt-pon2', portId: 'port-pon2', ip: '100.64.0.2', prefix: 24 },
    { id: 'l3-olt-sfp', portId: 'port-sfp1', ip: '203.0.113.2', prefix: 24 },
  ];

  // ── A 户：光猫桥接（不配地址），路由器自己拿 ISP 段地址
  routerA.l3.interfaces = [
    { id: 'l3-ra-wan', portId: 'port-wan1', ip: '100.64.0.20', prefix: 24 },
    { id: 'l3-ra-lan', portId: 'port-ge2', ip: '192.168.1.1', prefix: 24 },
  ];
  routerA.l3.defaultGateway = '100.64.0.1';
  routerA.services.nat = true;
  routerA.services.dhcp = {
    enabled: true,
    poolStart: '192.168.1.100',
    poolEnd: '192.168.1.150',
    gateway: '192.168.1.1',
    dns: ['192.168.1.1'],
  };
  routerA.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.10'] };
  // 路由器自带无线：A 户笔记本与手机直连它
  routerA.wireless = { mode: 'ap', ssid: 'Home-A', band: '5G', standard: '802.11ax', channel: 36 };

  // ── B 户：光猫路由模式，自己 NAT / DHCP / DNS
  ontB.l3.interfaces = [
    { id: 'l3-ob-wan', portId: 'port-pon1', ip: '100.64.0.30', prefix: 24 },
    { id: 'l3-ob-lan', portId: 'port-ge1', ip: '192.168.2.1', prefix: 24 },
  ];
  ontB.l3.defaultGateway = '100.64.0.2';
  ontB.services.nat = true;
  ontB.services.dhcp = {
    enabled: true,
    poolStart: '192.168.2.100',
    poolEnd: '192.168.2.150',
    gateway: '192.168.2.1',
    dns: ['192.168.2.1'],
  };
  ontB.services.dns = { enabled: true, records: [], forwarders: ['203.0.113.10'] };
  ontB.wireless = { mode: 'ap', ssid: 'Home-B', band: '2.4G', standard: '802.11n', channel: 6 };
  /*
   * B 户光猫是老的 EPON 1G（端口速率改小）——对端 OLT 是 10G-EPON，
   * 于是这条 PON 链路按 1G 协商，带宽诊断里能看到"按较低速率协商"。
   */
  ontB.ports = ontB.ports.map((port) =>
    port.id === 'port-pon1' ? { ...port, speedMbps: 1000 } : port,
  );

  for (const host of [pcA, lapA, phA, pcB, phB]) host.client = { mode: 'dhcp', dns: [] };
  lapA.wireless = { mode: 'sta', ssid: 'Home-A', band: '5G', standard: '802.11ax' };
  phA.wireless = { mode: 'sta', ssid: 'Home-A', band: '5G', standard: '802.11ac' };
  phB.wireless = { mode: 'sta', ssid: 'Home-B', band: '2.4G', standard: '802.11n' };

  const devices: Device[] = [
    cloud, olt, ontA, routerA, pcA, lapA, phA, ontB, pcB, phB,
  ];

  const cables: Cable[] = [
    { id: 'cbl-backbone', type: 'lc-sm', lengthM: 1500, a: { deviceId: cloud.id, portId: 'port-sfp1' }, b: { deviceId: olt.id, portId: 'port-sfp1' } },
    // A 户：OLT PON1 → 桥接光猫 → 路由器 WAN（光猫纯二层透传）
    { id: 'cbl-pon-a', type: 'lc-sm', lengthM: 800, a: { deviceId: olt.id, portId: 'port-pon1' }, b: { deviceId: ontA.id, portId: 'port-pon1' } },
    { id: 'cbl-onta-rt', type: 'cat6', lengthM: 2, a: { deviceId: ontA.id, portId: 'port-ge1' }, b: { deviceId: routerA.id, portId: 'port-wan1' } },
    { id: 'cbl-ra-pc', type: 'cat6', lengthM: 12, a: { deviceId: routerA.id, portId: 'port-ge2' }, b: { deviceId: pcA.id, portId: 'port-ge1' } },
    { id: 'cbl-wifi-lap-a', type: 'wireless', lengthM: 0, a: { deviceId: routerA.id, portId: 'port-wlan' }, b: { deviceId: lapA.id, portId: 'port-wlan' } },
    { id: 'cbl-wifi-ph-a', type: 'wireless', lengthM: 0, a: { deviceId: routerA.id, portId: 'port-wlan' }, b: { deviceId: phA.id, portId: 'port-wlan' } },
    // B 户：OLT PON2 → 路由光猫 → 终端
    { id: 'cbl-pon-b', type: 'lc-sm', lengthM: 950, a: { deviceId: olt.id, portId: 'port-pon2' }, b: { deviceId: ontB.id, portId: 'port-pon1' } },
    { id: 'cbl-ob-pc', type: 'cat5e', lengthM: 8, a: { deviceId: ontB.id, portId: 'port-ge1' }, b: { deviceId: pcB.id, portId: 'port-ge1' } },
    { id: 'cbl-wifi-ph-b', type: 'wireless', lengthM: 0, a: { deviceId: ontB.id, portId: 'port-wlan' }, b: { deviceId: phB.id, portId: 'port-wlan' } },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-ftth',
    name: '光接入（桥接光猫 vs 路由光猫）',
    description:
      '同一台 OLT 的两个 PON 口各带一个用户：A 户用桥接光猫 + 自备路由器做 NAT，' +
      'B 户用路由模式光猫一台搞定。B 户光猫是老的 EPON 1G，' +
      '所以那条 PON 链路按 1G 协商 —— 带宽诊断会写明"按较低速率协商"。',
    devices,
    cables,
    updatedAt: new Date().toISOString(),
  };
}
