/**
 * 引擎单元测试
 *
 * 断言的是**原因码序列**（而不是中文文案），因为文案会改、会翻译，原因码不会
 * （docs/07-diagnostics.md §1）。
 *
 * 覆盖 M0 的验收标准（docs/08-roadmap.md）：
 *   链路物理约束 / VLAN / 路由 / DHCP / NAT / DNS / 确定性 / 带宽瓶颈
 */

import { describe, expect, it } from 'vitest';
import { cableLabel, cableSpec, instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, type Cable, type Scenario } from '@toposmith/schema';
import { buildWorld, type World } from '../model';
import { bandwidth, dnsPath, pathTrace, ping } from '../diag';
import type { DnsSessionCache } from '../dns';

/* ────────────────────────────── 测试夹具 ────────────────────────────── */

interface Fixture {
  scenario: Scenario;
  world: World;
}

function cable(id: string, type: Cable['type'], lengthM: number, a: [string, string], b: [string, string]): Cable {
  return {
    id,
    type,
    lengthM,
    a: { deviceId: a[0], portId: a[1] },
    b: { deviceId: b[0], portId: b[1] },
  };
}

/**
 * 最小可用的家庭拓扑：云 ← OLT ← 光猫 ← 交换机 ← 台式机
 * 与预置场景同构，但只保留推演必需的元素。
 */
function buildFixture(): Fixture {
  const cloud = instantiate('cloud', 'dev-cloud', '云', 0, 0);
  const olt = instantiate('olt', 'dev-olt', 'OLT', 0, 0);
  const ont = instantiate('ont', 'dev-ont', '光猫', 0, 0);
  const sw = instantiate('switch-8-1g', 'dev-sw', '交换机', 0, 0);
  const pc = instantiate('pc-desktop', 'dev-pc', '台式机', 0, 0);

  cloud.l3.interfaces = [{ id: 'i1', portId: 'port-sfp1', ip: '203.0.113.10', prefix: 24 }];
  cloud.services.dns = {
    enabled: true,
    records: [
      { id: 'r1', name: 'www.example.com', ip: '203.0.113.10' },
    ],
    forwarders: [],
  };

  olt.l3.interfaces = [
    { id: 'i2', portId: 'port-pon1', ip: '100.64.0.1', prefix: 24 },
    { id: 'i3', portId: 'port-sfp1', ip: '203.0.113.1', prefix: 24 },
  ];

  ont.l3.interfaces = [
    { id: 'i4', portId: 'port-pon1', ip: '100.64.0.10', prefix: 24 },
    { id: 'i5', portId: 'port-ge1', ip: '192.168.1.1', prefix: 24 },
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

  sw.l3.interfaces = [{ id: 'i6', portId: 'port-ge1', ip: '192.168.1.2', prefix: 24 }];

  const scenario: Scenario = {
    schemaVersion: SCHEMA_VERSION,
    id: 'fixture',
    name: '测试拓扑',
    devices: [cloud, olt, ont, sw, pc],
    cables: [
      cable('c1', 'lc-sm', 1000, ['dev-cloud', 'port-sfp1'], ['dev-olt', 'port-sfp1']),
      cable('c2', 'lc-sm', 500, ['dev-olt', 'port-pon1'], ['dev-ont', 'port-pon1']),
      cable('c3', 'cat6', 5, ['dev-ont', 'port-ge1'], ['dev-sw', 'port-ge1']),
      cable('c4', 'cat6a', 15, ['dev-sw', 'port-ge2'], ['dev-pc', 'port-ge1']),
    ],
    updatedAt: '2026-09-17T00:00:00.000Z',
  };

  return { scenario, world: buildWorld(scenario) };
}

const codes = (steps: { code: string }[]) => steps.map((s) => s.code);

/* ────────────────────────────── 链路物理约束 ────────────────────────────── */

describe('链路协商与物理约束', () => {
  it('CAT6 超过 55 m 时 10G 降为 2.5G，并给出降速原因', () => {
    const { scenario } = buildFixture();
    scenario.cables[3] = cable('c4', 'cat6', 80, ['dev-sw', 'port-ge2'], ['dev-pc', 'port-ge1']);
    // 两端都换成 10GBASE-T 网卡，才能看出"是线缆把 10G 卡到了 2.5G"
    scenario.devices.find((d) => d.id === 'dev-sw')!.ports.find((p) => p.id === 'port-ge2')!.speedMbps = 10000;
    scenario.devices.find((d) => d.id === 'dev-pc')!.ports.find((p) => p.id === 'port-ge1')!.speedMbps = 10000;

    const world = buildWorld(scenario);
    const link = world.links.find((l) => l.id === 'c4')!;
    expect(link.up).toBe(true);
    expect(link.speedMbps).toBe(2500);
    expect(link.issues.map((i) => i.code)).toContain('LINK_SPEED_LIMITED');
  });

  it('线上超过线缆长度上限 → 链路不可用（不是降速）', () => {
    const { scenario } = buildFixture();
    scenario.cables[3] = cable('c4', 'cat6', 120, ['dev-sw', 'port-ge2'], ['dev-pc', 'port-ge1']);

    const world = buildWorld(scenario);
    const link = world.links.find((l) => l.id === 'c4')!;
    expect(link.up).toBe(false);
    expect(link.speedMbps).toBe(0);
    expect(link.issues.some((i) => i.code === 'LINK_TOO_LONG' && i.level === 'error')).toBe(true);
  });

  it('电口与光口直连 → 介质不匹配', () => {
    const { scenario } = buildFixture();
    scenario.cables.push(
      cable('bad', 'cat6', 5, ['dev-pc', 'port-ge1'], ['dev-cloud', 'port-sfp1']),
    );
    const world = buildWorld(scenario);
    const link = world.links.find((l) => l.id === 'bad')!;
    expect(link.up).toBe(false);
    expect(link.issues.map((i) => i.code)).toContain('MEDIUM_MISMATCH');
  });

  it('静态终端 + 链路超长 → 诊断给出 LINK_TOO_LONG', () => {
    const { scenario } = buildFixture();
    const pc = scenario.devices.find((d) => d.id === 'dev-pc')!;
    pc.client = { mode: 'static', ip: '192.168.1.50', prefix: 24, gateway: '192.168.1.1', dns: [] };
    scenario.cables[3] = cable('c4', 'cat6', 150, ['dev-sw', 'port-ge2'], ['dev-pc', 'port-ge1']);

    const result = ping(buildWorld(scenario), 'dev-pc', '192.168.1.2');
    expect(result.ok).toBe(false);
    expect(codes(result.steps)).toContain('LINK_TOO_LONG');
  });
});

/* ────────────────────────────── 二层 / VLAN ────────────────────────────── */

describe('二层与 VLAN', () => {
  it('同网段直连可达，且记录 ARP 与到达步骤', () => {
    const { world } = buildFixture();
    const result = ping(world, 'dev-pc', '192.168.1.2');
    expect(result.ok).toBe(true);
    expect(codes(result.steps)).toContain('ARP_OK');
    expect(codes(result.steps)).toContain('REACHED');
    expect(result.hops.length).toBe(2); // 台式机 + 交换机
  });

  it('VLAN 不一致 → VLAN_MISMATCH，并说明两端各属哪个 VLAN', () => {
    const { scenario } = buildFixture();
    const sw = scenario.devices.find((d) => d.id === 'dev-sw')!;
    const port = sw.ports.find((p) => p.id === 'port-ge2')!;
    port.vlan = 20; // 交换机侧改成 VLAN 20，PC 侧仍是 VLAN 1
    // VLAN 隔离后 DHCP 也拿不到地址，这里用静态地址，专门验证二层的 VLAN 判定
    scenario.devices.find((d) => d.id === 'dev-pc')!.client = {
      mode: 'static',
      ip: '192.168.1.50',
      prefix: 24,
      gateway: '192.168.1.1',
      dns: [],
    };

    const result = ping(buildWorld(scenario), 'dev-pc', '192.168.1.2');
    expect(result.ok).toBe(false);
    const step = result.steps.find((s) => s.code === 'VLAN_MISMATCH')!;
    expect(step).toBeDefined();
    expect(step.detail).toContain('VLAN 1');
    expect(step.detail).toContain('VLAN 20');
  });

  it('两端不在同一广播域时 DHCP 拿不到地址（广播不跨三层）', () => {
    const { scenario } = buildFixture();
    const sw = scenario.devices.find((d) => d.id === 'dev-sw')!;
    sw.ports.find((p) => p.id === 'port-ge2')!.vlan = 20;

    const world = buildWorld(scenario);
    const lease = world.leases.get('dev-pc')!;
    expect(lease.ok).toBe(false);
    expect(lease.failure).toBe('NO_DHCP_SERVER');
  });
});

/* ────────────────────────────── DHCP ────────────────────────────── */

describe('DHCP', () => {
  it('同广播域内获得租约，地址与网关来自地址池', () => {
    const { world } = buildFixture();
    const lease = world.leases.get('dev-pc')!;
    expect(lease.ok).toBe(true);
    expect(lease.address?.ip).toBe('192.168.1.100');
    expect(lease.address?.gateway).toBe('192.168.1.1');
    expect(lease.address?.dns).toEqual(['192.168.1.1']);
    expect(lease.serverId).toBe('dev-ont');
  });

  it('关闭 DHCP 服务 → 客户端无地址，诊断首错为 NO_DHCP_SERVER', () => {
    const { scenario } = buildFixture();
    scenario.devices.find((d) => d.id === 'dev-ont')!.services.dhcp!.enabled = false;

    const world = buildWorld(scenario);
    expect(world.addresses.has('dev-pc')).toBe(false);

    const result = ping(world, 'dev-pc', '192.168.1.1');
    expect(result.ok).toBe(false);
    expect(codes(result.steps)).toContain('NO_DHCP_SERVER');
  });

  it('地址池耗尽 → POOL_EXHAUSTED', () => {
    const { scenario } = buildFixture();
    const ont = scenario.devices.find((d) => d.id === 'dev-ont')!;
    ont.services.dhcp!.poolEnd = '192.168.1.100'; // 只有 1 个可用地址

    const sw = scenario.devices.find((d) => d.id === 'dev-sw')!;
    // 再加两台 DHCP 客户端，按 id 字典序第二台必然拿不到地址
    const extra1 = instantiate('pc-laptop', 'dev-a', '笔记本 A', 0, 0);
    const extra2 = instantiate('pc-laptop', 'dev-b', '笔记本 B', 0, 0);
    scenario.devices.push(extra1, extra2);
    scenario.cables.push(
      cable('c5', 'cat6', 5, ['dev-sw', 'port-ge3'], ['dev-a', 'port-ge1']),
      cable('c6', 'cat6', 5, ['dev-sw', 'port-ge4'], ['dev-b', 'port-ge1']),
    );
    void sw;

    const world = buildWorld(scenario);
    const failures = [...world.leases.values()].filter((l) => l.failure === 'POOL_EXHAUSTED');
    expect(failures.length).toBe(2);
  });
});

/* ────────────────────────────── 路由与 NAT ────────────────────────────── */

describe('路由与 NAT', () => {
  it('跨网段访问公网：命中默认路由、执行 SNAT 并送达', () => {
    const { world } = buildFixture();
    const result = ping(world, 'dev-pc', '203.0.113.10');
    expect(result.ok).toBe(true);
    expect(codes(result.steps)).toContain('NAT_SNAT');
    expect(codes(result.steps)).toContain('REACHED');
    // 台式机 → 光猫 → OLT → 云
    expect(result.hops.length).toBe(4);
  });

  it('关闭 NAT 后私网无法访问公网 → NAT_MISSING', () => {
    const { scenario } = buildFixture();
    scenario.devices.find((d) => d.id === 'dev-ont')!.services.nat = false;

    const result = ping(buildWorld(scenario), 'dev-pc', '203.0.113.10');
    expect(result.ok).toBe(false);
    expect(codes(result.steps)).toContain('NAT_MISSING');
  });

  it('目标不在任何广播域内 → ARP_FAILED，并列出域内设备', () => {
    const { world } = buildFixture();
    const result = ping(world, 'dev-pc', '192.168.1.99');
    expect(result.ok).toBe(false);
    const step = result.steps.find((s) => s.code === 'ARP_FAILED')!;
    expect(step.detail).toContain('192.168.1.99');
    expect(step.detail).toContain('交换机');
  });

  it('终端无网关且目标跨网段 → NO_GATEWAY', () => {
    const { scenario } = buildFixture();
    const pc = scenario.devices.find((d) => d.id === 'dev-pc')!;
    pc.client = { mode: 'static', ip: '192.168.1.50', prefix: 24, dns: [] };

    const result = ping(buildWorld(scenario), 'dev-pc', '203.0.113.10');
    expect(result.ok).toBe(false);
    expect(codes(result.steps)).toContain('NO_GATEWAY');
  });

  it('明细静态路由优先于默认路由（最长前缀匹配）', () => {
    const { scenario } = buildFixture();
    const pc = scenario.devices.find((d) => d.id === 'dev-pc')!;
    pc.client = {
      mode: 'static',
      ip: '192.168.1.50',
      prefix: 24,
      gateway: '192.168.1.1',
      dns: [],
    };
    pc.l3.staticRoutes = [{ id: 'sr1', dst: '203.0.113.0', prefix: 24, nextHop: '192.168.1.2' }];

    const result = ping(buildWorld(scenario), 'dev-pc', '203.0.113.10');
    const match = result.steps.find((s) => s.code === 'ROUTE_MATCH')!;
    expect(match.data?.['prefix']).toBe(24);
    expect(match.data?.['kind']).toBe('static');
  });
});

/* ────────────────────────────── 带宽 ────────────────────────────── */

describe('通讯速度', () => {
  it('瓶颈取路径上最小的链路速率（1G 端口）而非公网 10G 段', () => {
    const { world } = buildFixture();
    const result = bandwidth(world, 'dev-pc', '203.0.113.10');
    expect(result.ok).toBe(true);
    expect(result.metrics?.bottleneckMbps).toBe(1000);
    // 有线路径效率 0.95
    expect(result.metrics?.effectiveMbps).toBeCloseTo(950, 5);
    expect(result.metrics?.hasWireless).toBe(false);
    expect(result.metrics?.rttMs).toBeGreaterThan(0);
  });

  it('路径不可达时不做速度测算，而是给出可达性结论', () => {
    const { world } = buildFixture();
    const result = bandwidth(world, 'dev-pc', '10.9.9.9');
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('路径不可达');
    expect(result.metrics).toBeUndefined();
  });
});

/* ────────────────────────────── DNS ────────────────────────────── */

describe('DNS 解析路径', () => {
  it('首次解析走完整链路：本地 DNS 转发 → 权威应答，并写入缓存', () => {
    const { world } = buildFixture();
    const cache: DnsSessionCache = new Map();
    const result = dnsPath(world, 'dev-pc', 'www.example.com', { cache, nowMs: 1000 });

    expect(result.ok).toBe(true);
    expect(result.answer?.ip).toBe('203.0.113.10');
    expect(result.hops.length).toBe(2); // 光猫（转发）→ 云（权威）
    expect(cache.size).toBe(1);
  });

  it('同一会话内第二次相同查询命中缓存', () => {
    const { world } = buildFixture();
    const cache: DnsSessionCache = new Map();
    dnsPath(world, 'dev-pc', 'www.example.com', { cache, nowMs: 1000 });
    const second = dnsPath(world, 'dev-pc', 'www.example.com', { cache, nowMs: 2000 });

    expect(second.ok).toBe(true);
    expect(codes(second.steps)).toContain('DNS_CACHE_HIT');
    expect(second.summary).toContain('缓存命中');
  });

  it('域名不存在 → NXDOMAIN，并保留已走到的最后一跳', () => {
    const { world } = buildFixture();
    const result = dnsPath(world, 'dev-pc', 'nope.example.com');
    expect(result.ok).toBe(false);
    expect(codes(result.steps)).toContain('DNS_NXDOMAIN');
    expect(result.hops.length).toBe(2);
  });

  it('DNS 服务器不可达 → DNS_UNREACHABLE（含子链说明为什么不可达）', () => {
    const { scenario } = buildFixture();
    // 把下发的 DNS 指向一个不存在的地址所在网段
    scenario.devices.find((d) => d.id === 'dev-ont')!.services.dhcp!.dns = ['192.168.1.77'];

    const result = dnsPath(buildWorld(scenario), 'dev-pc', 'www.example.com');
    expect(result.ok).toBe(false);
    expect(codes(result.steps)).toContain('DNS_UNREACHABLE');
  });

  it('客户端未配置 DNS → NO_DNS_CONFIGURED', () => {
    const { world } = buildFixture();
    const scenarioNoDns = { ...buildFixture().scenario };
    scenarioNoDns.devices
      .find((d) => d.id === 'dev-ont')!
      .services.dhcp!.dns.splice(0, 1);
    const result = dnsPath(buildWorld(scenarioNoDns), 'dev-pc', 'www.example.com');
    expect(result.ok).toBe(false);
    expect(codes(result.steps)).toContain('NO_DNS_CONFIGURED');
    void world;
  });
});

/* ────────────────────────────── 确定性 ────────────────────────────── */

describe('确定性（NFR-03）', () => {
  it('同一场景两次推演得到完全相同的原因码序列', () => {
    const first = ping(buildWorld(buildFixture().scenario), 'dev-pc', '203.0.113.10');
    const second = ping(buildWorld(buildFixture().scenario), 'dev-pc', '203.0.113.10');
    expect(codes(first.steps)).toEqual(codes(second.steps));
    expect(JSON.stringify(first.hops)).toBe(JSON.stringify(second.hops));
  });

  it('buildWorld 不修改输入场景', () => {
    const { scenario } = buildFixture();
    const snapshot = JSON.stringify(scenario);
    buildWorld(scenario);
    expect(JSON.stringify(scenario)).toBe(snapshot);
  });
});

/* ────────────────────────────── 目录数据 ────────────────────────────── */

describe('目录数据（line 缆与光模块）', () => {
  it('俗称 CAT6e 映射到标准名 CAT6a，并在目录中明确标注', () => {
    expect(cableSpec('cat6a').label).toBe('CAT6a');
    expect(cableSpec('cat6a').alias).toBe('CAT6e');
    expect(cableSpec('cat6a').note).toContain('俗称');
    expect(cableLabel('cat6a')).toContain('CAT6e');
  });

  it('PON 口必须用光纤：单模光纤可连，双绞线被判为介质不匹配', () => {
    const { scenario } = buildFixture();
    expect(buildWorld(scenario).links.find((l) => l.id === 'c2')!.up).toBe(true);

    scenario.cables[1] = cable('c2', 'cat6a', 5, ['dev-olt', 'port-pon1'], ['dev-ont', 'port-pon1']);
    const link = buildWorld(scenario).links.find((l) => l.id === 'c2')!;
    expect(link.up).toBe(false);
    expect(link.issues.map((i) => i.code)).toContain('MEDIUM_MISMATCH');
  });

  it('光纤速率由两端模块决定：10G 光口与 1G 光口之间按 1G 协商', () => {
    const { scenario } = buildFixture();
    scenario.devices
      .find((d) => d.id === 'dev-cloud')!
      .ports.find((p) => p.id === 'port-sfp1')!.speedMbps = 1000;

    const link = buildWorld(scenario).links.find((l) => l.id === 'c1')!;
    expect(link.up).toBe(true);
    expect(link.speedMbps).toBe(1000);
    expect(link.issues.map((i) => i.code)).toContain('LINK_SPEED_NEGOTIATED');
  });
});

/* ────────────────────────────── 无线 ────────────────────────────── */

describe('无线关联', () => {
  function withWireless(apSsid: string, clientSsid: string) {
    const { scenario } = buildFixture();
    const ap = instantiate('ap', 'dev-ap', 'AP', 0, 0);
    const laptop = instantiate('pc-laptop', 'dev-lap', '笔记本', 0, 0);
    ap.wireless = { mode: 'ap', ssid: apSsid, band: '5G', standard: '802.11ax', channel: 149 };
    laptop.wireless = { mode: 'sta', ssid: clientSsid, band: '5G', standard: '802.11ax' };
    ap.l3.interfaces = [{ id: 'i7', portId: 'port-ge1', ip: '192.168.1.3', prefix: 24 }];
    scenario.devices.push(ap, laptop);
    scenario.cables.push(
      cable('c7', 'cat6', 5, ['dev-sw', 'port-ge3'], ['dev-ap', 'port-ge1']),
      cable('c8', 'wireless', 0, ['dev-ap', 'port-wlan'], ['dev-lap', 'port-wlan']),
    );
    return { scenario, world: buildWorld(scenario) };
  }

  it('SSID 不一致 → 链路不可用（SSID_MISMATCH）', () => {
    const { world } = withWireless('TopoSmith-AP', 'TopoSmith-Home');
    const link = world.links.find((l) => l.id === 'c8')!;
    expect(link.up).toBe(false);
    expect(link.issues.map((i) => i.code)).toContain('SSID_MISMATCH');
  });

  it('SSID 一致时可关联：速率按标准协商、半双工，且能拿到 DHCP 并访问网关', () => {
    const { world } = withWireless('Home', 'Home');
    const link = world.links.find((l) => l.id === 'c8')!;
    expect(link.up).toBe(true);
    expect(link.family).toBe('wireless');
    expect(link.speedMbps).toBe(1201); // 802.11ax 5GHz 标称
    expect(link.duplex).toBe('half');

    // 无线客户端与有线终端走同一条二层路径（D-12）
    expect(world.leases.get('dev-lap')?.ok).toBe(true);
    const result = ping(world, 'dev-lap', '192.168.1.2');
    expect(result.ok).toBe(true);
    expect(codes(result.steps)).toContain('REACHED');
  });

  it('瓶颈必须计入二层穿过的链路：无线 1201 Mbps 不得掩盖 1G 网线（D-23）', () => {
    const { world } = withWireless('Home', 'Home');
    const trace = pathTrace(world, 'dev-lap', '203.0.113.10');

    // 笔记本 → AP 这一跳，二层实际还穿过了 AP↔交换机、交换机↔光猫 两条网线
    expect(trace.hops[0]?.transitLinkIds?.length).toBeGreaterThanOrEqual(3);

    const result = bandwidth(world, 'dev-lap', '203.0.113.10');
    expect(result.ok).toBe(true);
    // 真实瓶颈是千兆网线，而不是无线协商速率 1201
    expect(result.metrics?.bottleneckMbps).toBe(1000);
    // 链路段数必须多于三层跳数 —— 否则就是"跳过了中间交换机"
    expect(result.metrics!.hops.length).toBeGreaterThan(trace.hops.length);
  });

  it('无线路径的有效吞吐按共享半双工折算，并说明并发客户端数', () => {
    const { world } = withWireless('Home', 'Home');
    const result = bandwidth(world, 'dev-lap', '192.168.1.2');
    expect(result.ok).toBe(true);
    expect(result.metrics?.hasWireless).toBe(true);
    expect(result.metrics?.wirelessConcurrency).toBe(1);
    // 1201 * 0.5 / 1 = 600.5，与有线瓶颈（1G × 0.95 = 950）取小
    expect(result.metrics?.effectiveMbps).toBeCloseTo(600.5, 1);
    expect(codes(result.steps)).toContain('WIFI_SHARED_MEDIUM');
  });
});

/* ────────────────────────────── 无线覆盖 ────────────────────────────── */

/**
 * 覆盖判定（D-56 / D-57）。
 *
 * 断言的都是**几何口径**：半径按 `1 米 = 20 世界单位` 换算，圆心取设备卡片中心，
 * 扇形按方位角判定。这些数字一旦漂移，"画出来的圈"和"判定用的圈"就不是同一个，
 * 而那种不一致在界面上极难发现 —— 所以必须钉在测试里。
 */
describe('无线覆盖判定', () => {
  function buildCoverageFixture(
    apCoverage: NonNullable<NonNullable<Scenario['devices'][number]['wireless']>['coverage']>,
    client: { dx: number; dy?: number; standard?: 'lte' | 'nr' | '802.11ax'; plmn?: string },
    apStandard: 'lte' | 'nr' | '802.11ax' = '802.11ax',
  ) {
    const { scenario } = buildFixture();
    const ap = instantiate(apStandard === '802.11ax' ? 'ap' : 'bs-5g', 'dev-ap', 'AP', 0, 0);
    const laptop = instantiate('pc-laptop', 'dev-lap', '笔记本', client.dx, client.dy ?? 0);
    ap.wireless = {
      mode: 'ap',
      ssid: apStandard === '802.11ax' ? 'Home' : undefined,
      standard: apStandard,
      plmn: apStandard === '802.11ax' ? undefined : '46000',
      coverage: apCoverage,
    };
    laptop.wireless = {
      mode: 'sta',
      ssid: client.standard === 'lte' || client.standard === 'nr' ? undefined : 'Home',
      standard: client.standard ?? '802.11ax',
      plmn: client.plmn,
    };
    ap.l3.interfaces = [{ id: 'i7', portId: 'port-ge1', ip: '192.168.1.3', prefix: 24 }];
    scenario.devices.push(ap, laptop);
    scenario.cables.push(
      cable('c7', 'cat6', 5, ['dev-sw', 'port-ge3'], ['dev-ap', 'port-ge1']),
      cable('c8', 'wireless', 0, ['dev-ap', 'port-wlan'], ['dev-lap', 'port-wlan']),
    );
    return { scenario, world: buildWorld(scenario) };
  }

  it('客户端在覆盖圈内 → 关联成立', () => {
    // 30 m = 600 世界单位；客户端中心距圆心 500 单位 = 25 m
    const { world } = buildCoverageFixture({ shape: 'omni', radiusM: 30 }, { dx: 500 });
    const link = world.links.find((l) => l.id === 'c8')!;
    expect(link.up).toBe(true);
    expect(link.issues.map((i) => i.code)).not.toContain('WIRELESS_OUT_OF_COVERAGE');
  });

  it('客户端被拖出覆盖圈 → 关联不成立，并说明差多远（WIRELESS_OUT_OF_COVERAGE）', () => {
    const { world } = buildCoverageFixture({ shape: 'omni', radiusM: 30 }, { dx: 700 });
    const link = world.links.find((l) => l.id === 'c8')!;
    const issue = link.issues.find((i) => i.code === 'WIRELESS_OUT_OF_COVERAGE')!;
    expect(link.up).toBe(false);
    expect(link.speedMbps).toBe(0);
    // 700 单位 = 35 m，半径 30 m → 还差 5 m
    expect(issue.text).toContain('相距 35 m');
    expect(issue.text).toContain('还差约 5 m');
  });

  it('半径按 1 米 = 20 世界单位换算：799 单位在内、801 单位在外', () => {
    const inside = buildCoverageFixture({ shape: 'omni', radiusM: 40 }, { dx: 799 });
    expect(inside.world.links.find((l) => l.id === 'c8')!.up).toBe(true);
    const outside = buildCoverageFixture({ shape: 'omni', radiusM: 40 }, { dx: 801 });
    expect(outside.world.links.find((l) => l.id === 'c8')!.up).toBe(false);
  });

  it('定向扇形只看朝向那一侧：正前方成立、侧后方不成立', () => {
    const front = buildCoverageFixture(
      { shape: 'sector', radiusM: 30, angleDeg: 90, azimuthDeg: 0 },
      { dx: 500 },
    );
    expect(front.world.links.find((l) => l.id === 'c8')!.up).toBe(true);

    // 客户端放在正上方（方位角 270°）→ 超出 ±45° 的扇形
    const behind = buildCoverageFixture(
      { shape: 'sector', radiusM: 30, angleDeg: 90, azimuthDeg: 0 },
      { dx: 0, dy: -500 },
    );
    const link = behind.world.links.find((l) => l.id === 'c8')!;
    expect(link.up).toBe(false);
    expect(link.issues.map((i) => i.code)).toContain('WIRELESS_OUT_OF_COVERAGE');
  });

  it('关掉覆盖（enabled: false）→ 不做判定，退回到旧行为', () => {
    const { world } = buildCoverageFixture(
      { shape: 'omni', radiusM: 30, enabled: false },
      { dx: 5000 },
    );
    const link = world.links.find((l) => l.id === 'c8')!;
    expect(link.up).toBe(true);
    expect(link.issues.map((i) => i.code)).not.toContain('WIRELESS_OUT_OF_COVERAGE');
  });

  it('WiFi 终端接不上蜂窝基站（RADIO_TECH_MISMATCH）', () => {
    const { world } = buildCoverageFixture({ shape: 'omni', radiusM: 150 }, { dx: 500 }, 'nr');
    const link = world.links.find((l) => l.id === 'c8')!;
    expect(link.up).toBe(false);
    expect(link.issues.map((i) => i.code)).toContain('RADIO_TECH_MISMATCH');
  });

  it('蜂窝：5G 终端接入 5G 基站按 NR 协商，并能桥接到回传侧拿到地址', () => {
    const { world } = buildCoverageFixture(
      { shape: 'omni', radiusM: 150 },
      { dx: 500, standard: 'nr', plmn: '46000' },
      'nr',
    );
    const link = world.links.find((l) => l.id === 'c8')!;
    expect(link.up).toBe(true);
    expect(link.speedMbps).toBe(1000);
    // 基站把无线客户端桥接到回传口：手机应与有线终端同网段
    expect(world.leases.get('dev-lap')?.ok).toBe(true);
    expect(ping(world, 'dev-lap', '192.168.1.2').ok).toBe(true);
  });

  it('蜂窝：4G 终端接 5G 基站按 LTE 回落（CELLULAR_RADIO_DOWNGRADE）', () => {
    const { world } = buildCoverageFixture(
      { shape: 'omni', radiusM: 150 },
      { dx: 500, standard: 'lte', plmn: '46000' },
      'nr',
    );
    const link = world.links.find((l) => l.id === 'c8')!;
    expect(link.up).toBe(true);
    expect(link.speedMbps).toBe(150);
    expect(link.issues.map((i) => i.code)).toContain('CELLULAR_RADIO_DOWNGRADE');
  });

  it('蜂窝：PLMN 不一致 → 关联不成立（CELLULAR_PLMN_MISMATCH）', () => {
    const { world } = buildCoverageFixture(
      { shape: 'omni', radiusM: 150 },
      { dx: 500, standard: 'nr', plmn: '46001' },
      'nr',
    );
    const link = world.links.find((l) => l.id === 'c8')!;
    expect(link.up).toBe(false);
    expect(link.issues.map((i) => i.code)).toContain('CELLULAR_PLMN_MISMATCH');
  });
});
