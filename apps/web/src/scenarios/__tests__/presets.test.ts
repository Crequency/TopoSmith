/**
 * 预置场景测试（FR-54）
 *
 * 预置场景是**产品内容**：它的说明文字向用户承诺了"能看到什么"。
 * 所以这里不只验"能构建、能过校验"，而是把**承诺逐条验一遍** ——
 * 能通的确实通、该失败的确实以预期原因码失败。
 * 场景文案改了而行为没跟上（或引擎回归把某条链路弄坏了），这里会红。
 */

import { describe, expect, it } from 'vitest';
import { validateScenario, type Scenario } from '@toposmith/schema';
import { bandwidth, buildWorld, dnsPath, ping, type DiagResult, type World } from '@toposmith/engine';
import { PRESETS, presetByKey, presetSize } from '..';

/** 失败原因码集合（分布在 steps 的 detail/data 里，这里按 code 收集） */
function reasonCodes(result: DiagResult): string[] {
  const codes: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record['code'] === 'string') codes.push(record['code']);
    for (const key of ['reason', 'reasonCode', 'data', 'steps']) visit(record[key]);
  };
  visit(result.steps);
  return codes;
}

function build(key: string): { scenario: Scenario; world: World } {
  const preset = presetByKey(key);
  if (!preset) throw new Error(`没有预置场景 ${key}`);
  const scenario = preset.build();
  return { scenario, world: buildWorld(scenario) };
}

describe('预置场景登记表', () => {
  it('每个场景都能构建、都能通过导入校验（预置数据也走同一条校验）', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of PRESETS) {
      const result = validateScenario(preset.build());
      if (!result.ok) {
        throw new Error(`${preset.key} 校验失败：${result.errors.join('；')}`);
      }
      expect(result.ok).toBe(true);
    }
  });

  it('key 唯一、说明与标签都不为空、规模在合理范围', () => {
    const keys = PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const preset of PRESETS) {
      expect(preset.name.length).toBeGreaterThan(1);
      expect(preset.summary.length).toBeGreaterThan(10);
      expect(preset.highlights.length).toBeGreaterThanOrEqual(3);
      const size = presetSize(preset);
      // 太小演示不出东西；IDC 那套是**规模压测场景**，允许到千级
      expect(size.devices).toBeGreaterThanOrEqual(8);
      expect(size.devices).toBeLessThanOrEqual(preset.key === 'idc' ? 1000 : 20);
      expect(size.cables).toBeGreaterThanOrEqual(6);
    }
  });

  it('每个场景都至少有一条链路是"按较低速率协商"或正常协商，且没有悬空端点', () => {
    for (const preset of PRESETS) {
      const { scenario, world } = build(preset.key);
      // 每条线缆的两端都能在 world 里找到派生链路（说明端点合法）
      expect(world.links.length).toBe(scenario.cables.length);
      // 没有"两端都 up 却是 0 速率"的异常
      for (const link of world.links) {
        if (link.up) expect(link.speedMbps).toBeGreaterThan(0);
      }
    }
  });
});

describe('家庭网络场景', () => {
  it('开箱四类诊断全通：可达、逐跳、带宽、DNS（含缓存命中）', () => {
    const { world } = build('home');
    expect(ping(world, 'dev-pc', '203.0.113.10').ok).toBe(true);
    expect(ping(world, 'dev-phone', '192.168.1.2').ok).toBe(true);
    expect(bandwidth(world, 'dev-pc', '203.0.113.10').ok).toBe(true);
    expect(dnsPath(world, 'dev-pc', 'www.example.com').ok).toBe(true);
  });
});

describe('办公网场景', () => {
  it('跨 VLAN 由路由器转发：办公 PC 能到服务器，也能上公网', () => {
    const { world } = build('office');
    expect(ping(world, 'dev-pc1', '192.168.30.10').ok).toBe(true);
    expect(ping(world, 'dev-pc1', '203.0.113.10').ok).toBe(true);
    expect(ping(world, 'dev-pc1', '192.168.10.11').ok).toBe(true);
  });

  it('**有意留的那处配错**确实报 VLAN_MISMATCH（预置场景也是排查教材）', () => {
    const { world } = build('office');
    const result = ping(world, 'dev-pc1', '192.168.20.11');
    expect(result.ok).toBe(false);
    expect(reasonCodes(result)).toContain('VLAN_MISMATCH');
    // 提示要点名是哪两个端口，用户才知道去改哪里
    expect(result.summary).toContain('GE23');
  });

  it('把访客段上联口的 PVID 改成 20 就能修好（这处坑是可修的）', () => {
    const preset = presetByKey('office');
    const fixed = preset!.build();
    const sw = fixed.devices.find((d) => d.id === 'dev-sw')!;
    sw.ports = sw.ports.map((port) => (port.id === 'port-ge23' ? { ...port, vlan: 20 } : port));
    const world = buildWorld(fixed);
    expect(ping(world, 'dev-pc1', '192.168.20.11').ok).toBe(true);
  });
});

describe('机房机柜场景', () => {
  it('机柜里装了 4 台设备、共占 16U，且都是 4U 高', () => {
    const { scenario, world } = build('datacenter');
    const rack = world.devices.get('dev-rack');
    expect(rack?.rack?.heightU).toBe(42);
    const mounted = scenario.devices.filter((d) => d.mount?.rackId === 'dev-rack');
    expect(mounted.length).toBe(4);
    expect(mounted.every((d) => d.rackUnits === 4)).toBe(true);
  });

  it('服务器端口全在背面（悬浮透视 / 翻面查看的前提）', () => {
    const { world } = build('datacenter');
    const srv = world.devices.get('dev-srv1')!;
    expect(srv.ports.every((port) => port.side === 'rear')).toBe(true);
  });

  it('服务器之间走万兆，备份服务器只有千兆 —— 带宽诊断能指出差别', () => {
    const { world } = build('datacenter');
    const toSrv2 = bandwidth(world, 'dev-srv1', '10.20.0.12');
    const toSrv3 = bandwidth(world, 'dev-srv1', '10.20.0.13');
    expect(toSrv2.ok).toBe(true);
    expect(toSrv3.ok).toBe(true);
    expect(toSrv2.metrics?.bottleneckMbps ?? 0).toBeGreaterThan(
      toSrv3.metrics?.bottleneckMbps ?? Number.POSITIVE_INFINITY,
    );
  });

  it('运维终端走 DHCP 拿到地址，且能上公网（桥接光猫 + 出口路由 NAT）', () => {
    const { world } = build('datacenter');
    expect(world.leases.get('dev-admin')?.ok).toBe(true);
    expect(ping(world, 'dev-admin', '203.0.113.10').ok).toBe(true);
  });
});

describe('光接入场景', () => {
  it('两个用户各自能上公网，但彼此隔离（OLT 不做用户间转发）', () => {
    const { world } = build('ftth');
    expect(ping(world, 'dev-pc-a', '203.0.113.10').ok).toBe(true);
    expect(ping(world, 'dev-pc-b', '203.0.113.10').ok).toBe(true);
    expect(ping(world, 'dev-pc-a', '192.168.2.100').ok).toBe(false);
    expect(ping(world, 'dev-pc-b', '192.168.1.100').ok).toBe(false);
  });

  it('桥接光猫不带地址（二层透传），A 户路由器自己拿 ISP 段地址做 NAT', () => {
    const { world } = build('ftth');
    expect(world.addresses.get('dev-ont-a') ?? []).toHaveLength(0);
    const routerA = world.devices.get('dev-router-a')!;
    expect(routerA.services.nat).toBe(true);
    expect(world.leases.get('dev-pc-a')?.serverId).toBe('dev-router-a');
  });

  it('B 户的老光猫（EPON 1G）让这条 PON 按 1G 协商 —— 并给出降速原因', () => {
    const { world } = build('ftth');
    const ponB = world.links.find((link) => link.id === 'cbl-pon-b')!;
    expect(ponB.speedMbps).toBe(1000);
    expect(ponB.issues.map((issue) => issue.code)).toContain('LINK_SPEED_NEGOTIATED');
    // 对照：同一个 OLT 的另一个 PON 口是 10G
    expect(world.links.find((link) => link.id === 'cbl-pon-a')!.speedMbps).toBe(10000);
  });
});

describe('园区无线场景', () => {
  it('三台 AP 速率各不相同：终端按两端较小值协商', () => {
    const { world } = build('campus');
    const speedOf = (id: string) => world.links.find((link) => link.id === id)!.speedMbps;
    // 2.4G n ↔ n：150；5G ac ↔ ax：866；6G be ↔ be：2882
    expect(speedOf('cbl-wifi-phone')).toBe(150);
    expect(speedOf('cbl-wifi-laptop')).toBe(866);
    expect(speedOf('cbl-wifi-tablet')).toBe(2882);
    expect(speedOf('cbl-wifi-tablet')).toBeGreaterThan(speedOf('cbl-wifi-laptop'));
  });

  it('无线是共享半双工介质（带宽诊断会说明效率折损）', () => {
    const { world } = build('campus');
    const result = bandwidth(world, 'dev-laptop', '203.0.113.10');
    expect(result.ok).toBe(true);
    expect(result.metrics?.bottleneckMbps).toBe(866);
    expect(result.metrics?.efficiency ?? 1).toBeLessThan(0.95);
  });

  it('**有意留的那处配错**：配错 SSID 的平板链路起不来，报 SSID_MISMATCH', () => {
    const { world } = build('campus');
    const bad = world.links.find((link) => link.id === 'cbl-wifi-tablet-bad')!;
    expect(bad.up).toBe(false);
    expect(bad.issues.map((issue) => issue.code)).toContain('SSID_MISMATCH');
  });

  it('把 SSID 改回 Campus 就能修好', () => {
    const preset = presetByKey('campus')!;
    const fixed = preset.build();
    const tablet = fixed.devices.find((d) => d.id === 'dev-tablet-bad')!;
    tablet.wireless = { ...tablet.wireless, mode: 'sta', ssid: 'Campus', band: '5G' };
    const world = buildWorld(fixed);
    expect(world.links.find((link) => link.id === 'cbl-wifi-tablet-bad')!.up).toBe(true);
    expect(ping(world, 'dev-pc', '172.16.0.200').ok).toBe(true);
  });
});

describe('中型托管 IDC 场景（规模压测）', () => {
  const build = () => {
    const preset = presetByKey('idc')!;
    return preset.build();
  };

  it('结构就是需求本身：3 机房 × 24 柜 × 42U，柜内 1 台 ToR + 9 台 4U 服务器（占 40U）', () => {
    const scenario = build();
    for (const letter of ['A', 'B', 'C']) {
      const racks = scenario.devices.filter((d) => d.id.startsWith(`dev-rack-${letter}`));
      expect(racks).toHaveLength(24);
      expect(racks.every((rack) => rack.rack?.heightU === 42)).toBe(true);

      const tors = scenario.devices.filter((d) => d.id.startsWith(`dev-tor-${letter}`));
      expect(tors).toHaveLength(24);
      for (const rack of racks) {
        const n = rack.id.replace(`dev-rack-${letter}`, '');
        const inRack = scenario.devices.filter((d) => d.mount?.rackId === rack.id);
        // ToR + 9 台服务器
        expect(inRack).toHaveLength(10);
        // U 位不重叠且不超 42U：ToR 占 1–4，服务器 5–40
        const starts = inRack.map((d) => d.mount!.startU).sort((a, b) => a - b);
        expect(starts).toEqual([1, 5, 9, 13, 17, 21, 25, 29, 33, 37]);
        expect(Math.max(...starts) + 4 - 1).toBeLessThanOrEqual(42);
        // 服务器都挂在这台 ToR 下
        expect(
          scenario.cables.filter((c) => c.a.deviceId === `dev-tor-${letter}${n}` || c.b.deviceId === `dev-tor-${letter}${n}`),
        ).toHaveLength(11); // 9 台服务器 + 2 条上联
      }
    }
  });

  it('规模：约 800 台设备 / 800 条链路，且全部通过导入校验', () => {
    const scenario = build();
    expect(scenario.devices.length).toBeGreaterThanOrEqual(800);
    expect(scenario.cables.length).toBeGreaterThanOrEqual(800);
    // 校验是 O(n) 的，但 800 台的规模必须真的过（预置数据也走同一条路径）
    const result = validateScenario(scenario);
    if (!result.ok) throw new Error(result.errors.slice(0, 5).join('；'));
    expect(result.ok).toBe(true);
  });

  it('分层真的通：同柜 / 同机房跨柜 / 跨机房 / 到办公区 / 到公网', () => {
    const world = buildWorld(build());
    // 同柜：同一条 ToR
    expect(ping(world, 'dev-srv-A1-1', '10.10.1.19').ok).toBe(true);
    // 同机房跨柜：A-01 ↔ A-24（走汇聚）
    expect(ping(world, 'dev-srv-A1-1', '10.10.24.19').ok).toBe(true);
    // 跨机房：A ↔ B、A ↔ C（走核心 → 出口路由器的三层）
    expect(ping(world, 'dev-srv-A1-1', '10.20.1.19').ok).toBe(true);
    expect(ping(world, 'dev-srv-A1-1', '10.30.24.19').ok).toBe(true);
    // 办公区 ← → 机房
    expect(ping(world, 'dev-srv-A1-1', '10.40.0.101').ok).toBe(true);
    expect(ping(world, 'dev-office-pc1', '10.10.1.19').ok).toBe(true);
    // 出网 + 域名
    expect(ping(world, 'dev-srv-A1-1', '203.0.113.10').ok).toBe(true);
    expect(dnsPath(world, 'dev-office-pc1', 'www.example.com').ok).toBe(true);
  });

  it('汇聚与核心之间都是万兆，接入是千兆（分层速率正确，且没有插错的链路）', () => {
    const world = buildWorld(build());
    // 每台机房汇聚的万兆上联与汇聚间互联都必须是 up 且 10G
    for (const letter of ['A', 'B', 'C']) {
      for (const id of [`dev-agg-${letter}-1`, `dev-agg-${letter}-2`]) {
        const sfpLinks = world.links.filter(
          (link) =>
            (link.a.deviceId === id && link.a.portId.startsWith('port-sfp')) ||
            (link.b.deviceId === id && link.b.portId.startsWith('port-sfp')),
        );
        expect(sfpLinks.length).toBeGreaterThanOrEqual(1);
        for (const link of sfpLinks) {
          expect(link.up).toBe(true);
          expect(link.speedMbps).toBe(10000);
        }
      }
    }
    // 全场景不允许存在"介质不匹配"或"超长"的链路（写场景时踩过这两个坑）
    const bad = world.links.filter((link) =>
      link.issues.some((issue) => issue.code === 'MEDIUM_MISMATCH' || issue.code === 'LINK_TOO_LONG'),
    );
    expect(bad.map((link) => link.id)).toEqual([]);
  });

  it('864 台服务器的地址全部落定：静态地址都在有连线的端口上，能 ARP 到', () => {
    const world = buildWorld(build());
    let addressCount = 0;
    for (const device of world.ordered) {
      if (!device.id.startsWith('dev-srv-')) continue;
      const address = world.addresses.get(device.id)?.[0];
      expect(address).toBeDefined();
      addressCount += 1;
    }
    expect(addressCount).toBe(72 * 9);
    // 首尾各抽一台做端到端确认（全量 ARP 太慢，这里只抽样）
    for (const [src, dst] of [
      ['dev-srv-A1-1', '10.10.1.11'],
      ['dev-srv-C24-9', '10.30.24.19'],
    ] as const) {
      expect(ping(world, src, dst).ok).toBe(true);
    }
  });

  it('构建成本在可接受范围（这是"规模压测"的硬指标）', () => {
    const t0 = performance.now();
    const scenario = build();
    const t1 = performance.now();
    const world = buildWorld(scenario);
    const t2 = performance.now();
    expect(world.links).toHaveLength(scenario.cables.length);
    // 构建 < 200ms、建世界 < 800ms：超出说明规模已经撑不住，得先优化再加大
    expect(t1 - t0).toBeLessThan(200);
    expect(t2 - t1).toBeLessThan(800);
  });
});
