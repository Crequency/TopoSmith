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
import { bandwidth, buildWorld, dnsPath, ping, type DiagResult, type World } from '@toposmith/anvil';
import { PRESETS, presetByKey, presetSize } from '..';

/** 某个原因码对应的步骤（断言"这一步报了什么"用） */
function stepsOf(result: DiagResult, code: string) {
  return result.steps.filter((step) => step.code === code);
}

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

  it('双上行是 LACP 聚合（bonded），所以这座 800 台设备的 IDC 里**一处环路都没有**', () => {
    const world = buildWorld(build());
    const bonded = world.links.filter((link) => link.cable.bonded);
    // 24 柜 × 3 机房 × 2 根上联
    expect(bonded).toHaveLength(24 * 3 * 2);
    expect(world.loops).toHaveLength(0);
    expect(world.loopLinkIds.size).toBe(0);
    // 环路告警不会被误挂到任何一条链路上
    expect(world.links.some((link) => link.issues.some((i) => i.code === 'L2_LOOP'))).toBe(false);
  });
});

describe('网络环路与广播风暴场景', () => {
  const world = () => buildWorld(presetByKey('loop')!.build());

  it('三处环都在办公段（VLAN 1），互不相同且路径闭合可核对', () => {
    const w = world();
    expect(w.loops).toHaveLength(3);
    expect(w.loops.every((loop) => loop.vlan === 1)).toBe(true);
    // 三条环路径：双上行冗余 / 自环跳线 / 无线中继
    const labels = w.loops.map((loop) => loop.label);
    expect(labels.some((label) => label.includes('GE23') && label.includes('GE24'))).toBe(true);
    expect(labels.some((label) => label.includes('GE7') && label.includes('GE8'))).toBe(true);
    expect(labels.some((label) => label.includes('WLAN'))).toBe(true);
    for (const loop of w.loops) {
      expect(loop.hasWireless).toBe(loop.label.includes('WLAN'));
      // 路径首尾是同一个端口（闭合），用户才能顺着核对
      const first = loop.label.split(' → ')[0];
      expect(loop.label.endsWith(first)).toBe(true);
    }
    expect(w.loops.some((loop) => loop.hasWireless)).toBe(true);
  });

  it('环上的线缆都挂上 L2_LOOP 告警，并给出环路径与风暴后果', () => {
    const w = world();
    expect([...w.loopLinkIds].sort()).toEqual([
      'cbl-a-ap1',
      'cbl-b-ap2',
      'cbl-redundant-1',
      'cbl-redundant-2',
      'cbl-self-loop',
      'cbl-wifi-relay',
    ]);
    const selfLoop = w.links.find((link) => link.id === 'cbl-self-loop')!;
    const issue = selfLoop.issues.find((item) => item.code === 'L2_LOOP')!;
    expect(issue.level).toBe('warn');
    expect(issue.text).toContain('GE7');
    expect(issue.text).toContain('广播');
    // 链路本身还是 up 的：环路是拓扑问题，不是"这根线坏了"
    expect(selfLoop.up).toBe(true);
  });

  it('办公段被风暴波及（12 台设备），服务器段完全不受影响 —— 风暴不跨 VLAN', () => {
    const w = world();
    expect(w.loops[0].affected.size).toBe(12);
    // VLAN 1：办公 PC ping 服务器，可达但要先报环路 + 风暴
    const fromOffice = ping(w, 'dev-pc1', '192.168.20.10');
    expect(fromOffice.ok).toBe(true);
    const codes = reasonCodes(fromOffice);
    expect(codes).toContain('L2_LOOP');
    expect(codes).toContain('BROADCAST_STORM');
    expect(fromOffice.summary).toContain('环路');
    // VLAN 20：两台服务器之间通信，链路上没有环路，诊断里一个字都不该提
    const inServerVlan = ping(w, 'dev-srv', '192.168.20.11');
    expect(inServerVlan.ok).toBe(true);
    expect(reasonCodes(inServerVlan)).not.toContain('L2_LOOP');
    expect(inServerVlan.summary).not.toContain('环路');
    // 目的端在环域内时（服务器 → 打印机）同样会报出来
    expect(reasonCodes(ping(w, 'dev-srv', '192.168.10.11'))).toContain('L2_LOOP');
  });

  it('带宽诊断会说明"这两个数字在没有风暴的前提下才成立"', () => {
    const w = world();
    const result = bandwidth(w, 'dev-pc1', '192.168.20.10');
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('环路');
    expect(stepsOf(result, 'BROADCAST_STORM').length).toBeGreaterThan(0);
  });

  it('三处环都能修好：聚合冗余线 / 拔掉自环跳线 / 撤掉无线中继', () => {
    // ① 把两根"冗余"线标成链路聚合 → 少一处环（这一处的修法是"聚合"而不是"拔线"）
    const bonded = presetByKey('loop')!.build();
    bonded.cables = bonded.cables.map((cable) =>
      cable.id === 'cbl-redundant-1' || cable.id === 'cbl-redundant-2'
        ? { ...cable, bonded: true }
        : cable,
    );
    const afterBond = buildWorld(bonded);
    // 双上行聚合成一条逻辑链路之后，它自己不再成环（原来那处环消失）
    expect(afterBond.loops).toHaveLength(2);
    // 剩下的两处环各自还带着"另外那两处错"：自环跳线与无线中继
    const remaining = afterBond.loops.map((loop) => loop.linkIds.join(','));
    expect(remaining.some((ids) => ids.includes('cbl-self-loop'))).toBe(true);
    expect(remaining.some((ids) => ids.includes('cbl-wifi-relay'))).toBe(true);
    for (const loop of afterBond.loops) {
      expect(
        loop.linkIds.some((id) => id === 'cbl-self-loop' || id === 'cbl-wifi-relay'),
      ).toBe(true);
    }

    // ② 三处一起修（拆掉冗余两根里的一根、拔掉自环跳线、撤掉无线中继）→ 环路归零
    const fixed = presetByKey('loop')!.build();
    fixed.cables = fixed.cables.filter(
      (cable) =>
        cable.id !== 'cbl-self-loop' &&
        cable.id !== 'cbl-wifi-relay' &&
        cable.id !== 'cbl-redundant-2',
    );
    const afterFix = buildWorld(fixed);
    expect(afterFix.loops).toHaveLength(0);
    expect(afterFix.loopLinkIds.size).toBe(0);
    // 修完之后办公段与服务器段都还是通的（不是靠"拔网线拔到断网"消除的告警）
    expect(ping(afterFix, 'dev-pc1', '192.168.20.10').ok).toBe(true);
    expect(ping(afterFix, 'dev-pc2', '192.168.10.11').ok).toBe(true);
  });

  it('场景本身通过导入校验（聚合标记的成员数、VLAN 一致性都在校验范围内）', () => {
    const result = validateScenario(presetByKey('loop')!.build());
    if (!result.ok) throw new Error(result.errors.join('；'));
    expect(result.ok).toBe(true);
  });
});

describe('链路聚合数据的导入校验', () => {
  it('孤零零一根成员线缆勾了聚合 → 校验失败并说明原因', () => {
    const scenario = presetByKey('home')!.build();
    scenario.cables[0] = { ...scenario.cables[0], bonded: true };
    const result = validateScenario(scenario);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('聚合');
  });

  it('无线关联不能做链路聚合', () => {
    const scenario = presetByKey('home')!.build();
    const wifi = scenario.cables.findIndex((cable) => cable.type === 'wireless');
    scenario.cables[wifi] = { ...scenario.cables[wifi], bonded: true };
    const result = validateScenario(scenario);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('无线');
  });
});

/* ────────────────────────────── 无线覆盖 ────────────────────────────── */

describe('无线覆盖（D-56 / D-57）', () => {
  it('每个预置场景里的无线提供方都带覆盖信息（画布上都有圈可看）', () => {
    for (const preset of PRESETS) {
      const { scenario, world } = build(preset.key);
      for (const device of scenario.devices) {
        if (device.wireless?.mode !== 'ap') continue;
        if (!device.ports.some((port) => port.medium === 'wifi')) continue;
        expect(device.wireless.coverage, `${preset.key} / ${device.id} 缺少覆盖配置`).toBeDefined();
        expect(device.wireless.coverage?.radiusM).toBeGreaterThan(0);
        // coverage 必须是**每台设备各自的**，浅拷贝共享会导致改一台动全部（模板 instantiate 的坑）
        const peer = scenario.devices.find(
          (other) => other.id !== device.id && other.wireless?.coverage && other.kind === device.kind,
        );
        if (peer) expect(peer.wireless?.coverage).not.toBe(device.wireless.coverage);
      }
      // 覆盖信息齐全时，无线关联就不该再画成线（判据与绘制层共用）
      for (const link of world.links) {
        if (link.family !== 'wireless') continue;
        expect(['a', 'b'].some((side) => {
          const id = side === 'a' ? link.a.deviceId : link.b.deviceId;
          const device = world.devices.get(id);
          return device?.wireless?.coverage !== undefined;
        })).toBe(true);
      }
    }
  });

  it('家庭场景：笔记本与手机都在 AP 的覆盖圈内（覆盖不改变既有的可达结论）', () => {
    const { scenario, world } = build('home');
    const ap = scenario.devices.find((d) => d.id === 'dev-ap')!;
    for (const id of ['dev-laptop', 'dev-phone']) {
      const link = world.links.find((l) => l.a.deviceId === id || l.b.deviceId === id)!;
      expect(link.up).toBe(true);
    }
    expect(ap.wireless?.coverage?.shape).toBe('omni');
  });
});

describe('蜂窝网络场景', () => {
  it('结构：一台 4G 全向基站 + 两台 5G 定向基站，覆盖各自独立', () => {
    const { scenario } = build('cellular');
    const stations = scenario.devices.filter((d) => d.kind === 'base-station');
    expect(stations).toHaveLength(3);
    expect(stations.filter((d) => d.wireless?.standard === 'lte')).toHaveLength(1);
    expect(stations.filter((d) => d.wireless?.standard === 'nr')).toHaveLength(2);
    // 定向的两台朝向不同：一台朝右、一台朝下
    const azimuths = stations
      .map((d) => d.wireless?.coverage)
      .filter((c) => c?.shape === 'sector')
      .map((c) => c?.azimuthDeg);
    expect(azimuths.sort()).toEqual([0, 90]);
  });

  it('在覆盖内的蜂窝终端按世代协商速率：4G 150 Mbps、5G 1000 Mbps', () => {
    const { world } = build('cellular');
    expect(world.links.find((l) => l.id === 'cbl-lte-phone-a')!.speedMbps).toBe(150);
    expect(world.links.find((l) => l.id === 'cbl-nr-a-phone')!.speedMbps).toBe(1000);
    expect(world.links.find((l) => l.id === 'cbl-nr-a-cpe')!.speedMbps).toBe(1000);
  });

  it('**有意留的三处问题**：扇区外、覆盖外、制式不对，各自报不同的原因码', () => {
    const { world } = build('cellular');

    const offSector = world.links.find((l) => l.id === 'cbl-nr-b-off')!;
    expect(offSector.up).toBe(false);
    expect(offSector.issues.map((i) => i.code)).toContain('WIRELESS_OUT_OF_COVERAGE');
    // 距离确实在半径内（问题出在方向上），报文里要说清是定向
    expect(offSector.issues[0]?.text).toContain('定向');

    const outside = world.links.find((l) => l.id === 'cbl-nr-a-out')!;
    expect(outside.up).toBe(false);
    expect(outside.issues.map((i) => i.code)).toContain('WIRELESS_OUT_OF_COVERAGE');

    const wifi = world.links.find((l) => l.id === 'cbl-lte-wifi')!;
    expect(wifi.up).toBe(false);
    expect(wifi.issues.map((i) => i.code)).toContain('RADIO_TECH_MISMATCH');
  });

  it('蜂窝终端能拿到地址、经核心路由器出网（基站是二层桥接，不是隧道）', () => {
    const { world } = build('cellular');
    expect(world.leases.get('dev-phone-4g-a')?.ok).toBe(true);
    expect(ping(world, 'dev-phone-4g-a', '203.0.113.1').ok).toBe(true);
    // 跑出覆盖的平板有静态地址，但关联不成立 —— 诊断报的是链路不可用
    expect(ping(world, 'dev-pc', '10.10.0.222').ok).toBe(false);
  });

  it('5G CPE：无线口做上行、LAN 口带台式机（无线宽带 FWA）', () => {
    const { world } = build('cellular');
    // CPE 的 WAN 侧拿到的是蜂窝段地址（运营商静态开通），LAN 侧是自己的网关
    const cpeAddrs = world.addresses.get('dev-cpe') ?? [];
    expect(cpeAddrs.find((a) => a.portId === 'port-5g-nr')?.ip).toBe('10.10.0.120');
    expect(cpeAddrs.find((a) => a.portId === 'port-ge1')?.ip).toBe('192.168.8.1');
    // 台式机在 CPE 的内网里，能经 CPE 的 NAT 出公网
    expect(ping(world, 'dev-pc', '192.168.8.1').ok).toBe(true);
    expect(ping(world, 'dev-pc', '203.0.113.1').ok).toBe(true);
  });

  it('共享介质：同一个小区里的多台终端被算作并发客户端（带宽诊断按共享空口折扣）', () => {
    const { world } = build('cellular');
    const result = bandwidth(world, 'dev-phone-4g-a', '203.0.113.1');
    expect(result.ok).toBe(true);
    expect(result.metrics?.hasWireless).toBe(true);
    // 蜂窝与 WiFi 共用同一个原因码，但文案必须说"同一小区/单用户峰值"，
    // 否则用户会把"5G 标称 1 Gbps"当成"我能用 1 Gbps"
    const shared = result.steps.find((step) => step.code === 'WIFI_SHARED_MEDIUM');
    expect(shared?.detail).toContain('单用户峰值');
    expect(shared?.detail).toContain('同一小区');
    // 两台 4G 手机 + 5G 扇区里那台手机同处一个广播域：空口是共享的
    expect(result.metrics?.wirelessConcurrency).toBe(3);
    // 4G 的标称 150 Mbps 是单用户峰值，真实吞吐还要再打共享与半双工的折扣
    expect(result.metrics?.effectiveMbps).toBeLessThan(150);
  });

  it('把跑出覆盖的平板拖回扇区就能修好（这处坑是可修的）', () => {
    const { scenario, world } = build('cellular');
    const before = world.links.find((l) => l.id === 'cbl-nr-a-out')!;
    expect(before.up).toBe(false);

    // 拖到 5G 基站 A 的正前方（仍在 70 m 半径内）
    const tablet = scenario.devices.find((d) => d.id === 'dev-tablet-out')!;
    const station = scenario.devices.find((d) => d.id === 'dev-bs-5g-a')!;
    tablet.x = station.x + 1200;
    tablet.y = station.y;

    const after = buildWorld(scenario).links.find((l) => l.id === 'cbl-nr-a-out')!;
    expect(after.up).toBe(true);
    expect(after.speedMbps).toBe(1000);
  });
});
