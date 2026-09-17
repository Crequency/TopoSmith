/**
 * 二层环路检测单元测试（FR-67）
 *
 * 环路检测最容易出的两种错都不是"漏报"，而是**误报**与**说不清**：
 *   - 误报：把"主机接了两根线"、"跨 VLAN 的两条链路"、"做了聚合的双上行"当成环路 ——
 *     用户从此不再相信告警；
 *   - 说不清：只说"有环"，不给出环路径，用户没法核对也没法修。
 * 所以这里既验"该报的报"，也逐条验"不该报的不报"，并断言环路径文本真的闭合。
 */

import { describe, expect, it } from 'vitest';
import { instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, type Cable, type Device, type Scenario } from '@toposmith/schema';
import { buildWorld } from '../model';
import { detectL2Loops, MAX_REPORTED_LOOPS, scanL2Loops } from '../l2/loop';
import { ping } from '../diag';

/* ────────────────────────────── 夹具 ────────────────────────────── */

function cable(
  id: string,
  type: Cable['type'],
  lengthM: number,
  a: [string, string],
  b: [string, string],
  bonded?: boolean,
): Cable {
  return {
    id,
    type,
    lengthM,
    a: { deviceId: a[0], portId: a[1] },
    b: { deviceId: b[0], portId: b[1] },
    ...(bonded ? { bonded } : {}),
  };
}

/** 造一个"两个交换机 + 若干终端"的场景骨架，拓扑由调用方给 */
function scenarioOf(devices: Device[], cables: Cable[]): Scenario {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'scenario-test',
    name: '环路测试',
    devices,
    cables,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function switchPair(): { a: Device; b: Device; host: Device } {
  return {
    a: instantiate('switch-8-1g', 'dev-a', '交换机A', 0, 0),
    b: instantiate('switch-8-1g', 'dev-b', '交换机B', 0, 0),
    host: instantiate('pc-desktop', 'dev-host', '台式机', 0, 0),
  };
}

/* ────────────────────────────── 该报的报 ────────────────────────────── */

describe('二层环路检测：该报的报', () => {
  it('两台交换机之间并联两根线（没做聚合）= 一处环，环路径闭合且点名端口', () => {
    const { a, b } = switchPair();
    const world = buildWorld(
      scenarioOf(
        [a, b],
        [
          cable('c1', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-b', 'port-ge1']),
          cable('c2', 'cat6', 2, ['dev-a', 'port-ge2'], ['dev-b', 'port-ge2']),
        ],
      ),
    );

    const loops = detectL2Loops(world);
    expect(loops).toHaveLength(1);
    expect(loops[0].vlan).toBe(1);
    expect(loops[0].linkIds).toEqual(['c1', 'c2']);
    expect(loops[0].deviceIds).toEqual(['dev-a', 'dev-b']);
    expect(loops[0].hasWireless).toBe(false);
    expect(loops[0].slowestMbps).toBe(1000);
    // 环路径首尾相接、且两端端口都在文本里
    expect(loops[0].label.startsWith('交换机A GE1 →')).toBe(true);
    expect(loops[0].label.endsWith('交换机A GE1')).toBe(true);
    expect(loops[0].label).toContain('交换机B GE1');
    expect(loops[0].label).toContain('交换机B GE2');
    expect(loops[0].label).toContain('交换机A GE2');
  });

  it('一根跳线两端插在同一台交换机上 = 一处环（自环）', () => {
    const { a, host } = switchPair();
    const world = buildWorld(
      scenarioOf(
        [a, host],
        [
          cable('c1', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-host', 'port-ge1']),
          cable('c-self', 'cat5e', 1, ['dev-a', 'port-ge2'], ['dev-a', 'port-ge3']),
        ],
      ),
    );

    const loops = detectL2Loops(world);
    expect(loops).toHaveLength(1);
    expect(loops[0].linkIds).toEqual(['c-self']);
    expect(loops[0].deviceIds).toEqual(['dev-a']);
    expect(loops[0].label).toBe('交换机A GE2 → 交换机A GE3 → 交换机A GE2');
  });

  it('无线也参与环路：AP 既接网线又做无线中继，两处环一起报出来', () => {
    const swA = instantiate('switch-8-1g', 'dev-a', '交换机A', 0, 0);
    const swB = instantiate('switch-8-1g', 'dev-b', '交换机B', 0, 0);
    const ap1 = instantiate('ap', 'dev-ap1', '办公 AP', 0, 0);
    const ap2 = instantiate('ap', 'dev-ap2', '中继 AP', 0, 0);
    ap1.wireless = { mode: 'ap', ssid: 'X', band: '5G', standard: '802.11ax' };
    ap2.wireless = { mode: 'sta', ssid: 'X', band: '5G', standard: '802.11ax' };

    const world = buildWorld(
      scenarioOf(
        [swA, swB, ap1, ap2],
        [
          // 唯一的交换机间通路（本来不成环）
          cable('c-lan', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-b', 'port-ge1']),
          cable('c-ap1', 'cat6', 2, ['dev-a', 'port-ge2'], ['dev-ap1', 'port-ge1']),
          cable('c-ap2', 'cat6', 2, ['dev-b', 'port-ge2'], ['dev-ap2', 'port-ge1']),
          // 无线中继把两台 AP 又连起来 —— 环由此闭合（无线口承载 VLAN 1）
          cable('c-relay', 'wireless', 0, ['dev-ap1', 'port-wlan'], ['dev-ap2', 'port-wlan']),
        ],
      ),
    );

    const loops = detectL2Loops(world);
    expect(loops).toHaveLength(1);
    expect(loops[0].hasWireless).toBe(true);
    expect(loops[0].linkIds).toEqual(['c-ap1', 'c-ap2', 'c-lan', 'c-relay']);
    expect(loops[0].label).toContain('WLAN');
  });

  it('聚合了其中两根、第三根没聚合 —— 没聚合的那根仍然是环', () => {
    const { a, b } = switchPair();
    const world = buildWorld(
      scenarioOf(
        [a, b],
        [
          cable('c1', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-b', 'port-ge1'], true),
          cable('c2', 'cat6', 2, ['dev-a', 'port-ge2'], ['dev-b', 'port-ge2'], true),
          cable('c3', 'cat6', 2, ['dev-a', 'port-ge3'], ['dev-b', 'port-ge3']),
        ],
      ),
    );

    const loops = detectL2Loops(world);
    expect(loops).toHaveLength(1);
    // 环上一定包含没聚合的那根；聚合组的两根作为"一条逻辑链路"也在环上
    expect(loops[0].linkIds).toEqual(['c1', 'c2', 'c3']);
    // 聚合组是两个节点，它们的成员端口都在环上（两个上联口都传同一份广播帧）
    expect(loops[0].ports.map((port) => port.portId)).toEqual([
      'port-ge1',
      'port-ge2',
      'port-ge3',
      'port-ge1',
      'port-ge2',
      'port-ge3',
    ]);
    expect(loops[0].label).toContain('（聚合 2 根）');
  });
});

/* ────────────────────────── 不该报的一个都不能报 ────────────────────────── */

describe('二层环路检测：不许误报', () => {
  it('树形拓扑（交换机级联 + 终端）没有环', () => {
    const swA = instantiate('switch-8-1g', 'dev-a', '交换机A', 0, 0);
    const swB = instantiate('switch-8-1g', 'dev-b', '交换机B', 0, 0);
    const pc = instantiate('pc-desktop', 'dev-pc', '台式机', 0, 0);
    const world = buildWorld(
      scenarioOf(
        [swA, swB, pc],
        [
          cable('c1', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-b', 'port-ge1']),
          cable('c2', 'cat6', 2, ['dev-b', 'port-ge2'], ['dev-pc', 'port-ge1']),
        ],
      ),
    );
    expect(detectL2Loops(world)).toHaveLength(0);
  });

  it('同一台主机接了两根线到两台交换机：主机不转发帧，不成环', () => {
    const swA = instantiate('switch-8-1g', 'dev-a', '交换机A', 0, 0);
    const swB = instantiate('switch-8-1g', 'dev-b', '交换机B', 0, 0);
    const srv = instantiate('server-rack', 'dev-srv', '服务器', 0, 0);
    const world = buildWorld(
      scenarioOf(
        [swA, swB, srv],
        [
          cable('c-lan', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-b', 'port-ge1']),
          cable('c1', 'cat6', 2, ['dev-a', 'port-ge2'], ['dev-srv', 'port-ge1']),
          cable('c2', 'cat6', 2, ['dev-b', 'port-ge2'], ['dev-srv', 'port-ge2']),
        ],
      ),
    );
    // server-rack 的两个 RJ45 口各接一根，但它是终端而不是网桥
    expect(detectL2Loops(world)).toHaveLength(0);
  });

  it('同一对交换机接了两根线、但分属不同 VLAN：各自 VLAN 内都不成环', () => {
    const a = instantiate('switch-8-1g', 'dev-a', '交换机A', 0, 0);
    const b = instantiate('switch-8-1g', 'dev-b', '交换机B', 0, 0);
    const vlan = (device: Device, portId: string, value: number): void => {
      device.ports = device.ports.map((port) =>
        port.id === portId ? { ...port, role: 'access', vlan: value } : port,
      );
    };
    vlan(a, 'port-ge1', 10);
    vlan(b, 'port-ge1', 10);
    vlan(a, 'port-ge2', 20);
    vlan(b, 'port-ge2', 20);

    const world = buildWorld(
      scenarioOf(
        [a, b],
        [
          cable('c1', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-b', 'port-ge1']),
          cable('c2', 'cat6', 2, ['dev-a', 'port-ge2'], ['dev-b', 'port-ge2']),
        ],
      ),
    );
    expect(detectL2Loops(world)).toHaveLength(0);
  });

  it('双上行**做了聚合**（bonded）= 一条逻辑链路，不报环', () => {
    const { a, b } = switchPair();
    const world = buildWorld(
      scenarioOf(
        [a, b],
        [
          cable('c1', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-b', 'port-ge1'], true),
          cable('c2', 'cat6', 2, ['dev-a', 'port-ge2'], ['dev-b', 'port-ge2'], true),
        ],
      ),
    );
    const scan = scanL2Loops(world);
    expect(scan.loops).toHaveLength(0);
    expect(scan.loopLinkIds.size).toBe(0);
    expect(scan.total).toBe(0);
  });

  it('介质不匹配导致 down 的线缆不构成环路（它本来就不通帧）', () => {
    const { a, b } = switchPair();
    const world = buildWorld(
      scenarioOf(
        [a, b],
        [
          cable('c1', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-b', 'port-ge1']),
          // 光纤插进电口：链路 down
          cable('c2', 'lc-sm', 2, ['dev-a', 'port-ge2'], ['dev-b', 'port-ge2']),
        ],
      ),
    );
    expect(world.links.find((link) => link.id === 'c2')?.up).toBe(false);
    expect(detectL2Loops(world)).toHaveLength(0);
  });

  it('路由模式网关的不同 VLAN LAN 口在内部不会互桥（否则会凭空成环）', () => {
    const ont = instantiate('ont', 'dev-ont', '光猫', 0, 0);
    const sw = instantiate('switch-8-1g', 'dev-sw', '交换机', 0, 0);
    const vlan = (device: Device, portId: string, value: number): void => {
      device.ports = device.ports.map((port) =>
        port.id === portId ? { ...port, role: 'access', vlan: value } : port,
      );
    };
    vlan(ont, 'port-ge2', 20);
    vlan(sw, 'port-ge2', 20);
    ont.l3.interfaces = [{ id: 'i1', portId: 'port-ge1', ip: '192.168.1.1', prefix: 24 }];

    const world = buildWorld(
      scenarioOf(
        [ont, sw],
        [
          // 光猫 GE1（VLAN 1）与 GE2（VLAN 20）各接交换机的一个口：
          // 物理上是两台设备之间的两根线，但两个口分属不同 VLAN，不是环
          cable('c1', 'cat6', 2, ['dev-ont', 'port-ge1'], ['dev-sw', 'port-ge1']),
          cable('c2', 'cat6', 2, ['dev-ont', 'port-ge2'], ['dev-sw', 'port-ge2']),
        ],
      ),
    );
    expect(detectL2Loops(world)).toHaveLength(0);
  });
});

/* ────────────────────────── 诊断结论与上限 ────────────────────────── */

describe('环路结论：链路告警与诊断步骤', () => {
  it('卷进环路的每条线缆都会被挂上 L2_LOOP 告警，并带上环路径', () => {
    const { a, b } = switchPair();
    const world = buildWorld(
      scenarioOf(
        [a, b],
        [
          cable('c1', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-b', 'port-ge1']),
          cable('c2', 'cat6', 2, ['dev-a', 'port-ge2'], ['dev-b', 'port-ge2']),
        ],
      ),
    );
    for (const id of ['c1', 'c2']) {
      const link = world.links.find((item) => item.id === id)!;
      const issue = link.issues.find((item) => item.code === 'L2_LOOP');
      expect(issue).toBeDefined();
      expect(issue?.level).toBe('warn');
      expect(issue?.text).toContain('交换机A GE1');
      // 告警不影响链路可用性：环路是拓扑问题，不是"这根线坏了"
      expect(link.up).toBe(true);
    }
    // 没卷进环路的链路不会被挂这个告警
    const host = instantiate('pc-desktop', 'dev-pc', '台式机', 0, 0);
    const world2 = buildWorld(
      scenarioOf([a, host], [cable('c3', 'cat6', 2, ['dev-a', 'port-ge3'], ['dev-pc', 'port-ge1'])]),
    );
    expect(world2.links[0].issues.some((item) => item.code === 'L2_LOOP')).toBe(false);
  });

  it('源在环域内时，ping 会给出「环路 + 风暴」两步告警，但结论仍是拓扑可达', () => {
    const ont = instantiate('ont', 'dev-ont', '光猫', 0, 0);
    const swA = instantiate('switch-8-1g', 'dev-a', '交换机A', 0, 0);
    const swB = instantiate('switch-8-1g', 'dev-b', '交换机B', 0, 0);
    const pc = instantiate('pc-desktop', 'dev-pc', '台式机', 0, 0);
    ont.l3.interfaces = [{ id: 'i1', portId: 'port-ge1', ip: '192.168.1.1', prefix: 24 }];
    ont.services.dhcp = {
      enabled: true,
      poolStart: '192.168.1.100',
      poolEnd: '192.168.1.120',
      gateway: '192.168.1.1',
      dns: ['192.168.1.1'],
    };

    const world = buildWorld(
      scenarioOf(
        [ont, swA, swB, pc],
        [
          cable('c-ont', 'cat6', 2, ['dev-ont', 'port-ge1'], ['dev-a', 'port-ge1']),
          cable('c-ab1', 'cat6', 2, ['dev-a', 'port-ge2'], ['dev-b', 'port-ge1']),
          cable('c-ab2', 'cat6', 2, ['dev-a', 'port-ge3'], ['dev-b', 'port-ge2']),
          cable('c-pc', 'cat6', 2, ['dev-b', 'port-ge3'], ['dev-pc', 'port-ge1']),
        ],
      ),
    );

    const result = ping(world, 'dev-pc', '192.168.1.1');
    expect(result.ok).toBe(true);
    const codes = result.steps.map((step) => step.code);
    expect(codes).toContain('L2_LOOP');
    expect(codes).toContain('BROADCAST_STORM');
    for (const step of result.steps.filter((s) => s.code === 'L2_LOOP' || s.code === 'BROADCAST_STORM')) {
      expect(step.level).toBe('warn');
    }
    // 结论里必须点名"环路"，否则用户只看 summary 会以为一切正常
    expect(result.summary).toContain('环路');
    // 披露不能少：不建模风暴动力学、也不建模 STP 状态机
    const storm = result.steps.find((step) => step.code === 'BROADCAST_STORM')!;
    expect(storm.detail).toContain('STP');
    expect(storm.detail).toContain('MAC');
  });

  it('环数超过上限时仍然把**全部**卷进环路的线缆标记出来', () => {
    // 33 组互不相干的"并联双线"，每组一处环 —— 超过 MAX_REPORTED_LOOPS
    const devices: Device[] = [];
    const cables: Cable[] = [];
    for (let i = 0; i < MAX_REPORTED_LOOPS + 1; i += 1) {
      const a = instantiate('switch-8-1g', `dev-a${i}`, `A${i}`, 0, 0);
      const b = instantiate('switch-8-1g', `dev-b${i}`, `B${i}`, 0, 0);
      devices.push(a, b);
      cables.push(
        cable(`c${i}-1`, 'cat6', 2, [`dev-a${i}`, 'port-ge1'], [`dev-b${i}`, 'port-ge1']),
        cable(`c${i}-2`, 'cat6', 2, [`dev-a${i}`, 'port-ge2'], [`dev-b${i}`, 'port-ge2']),
      );
    }
    const scan = scanL2Loops(buildWorld(scenarioOf(devices, cables)));
    expect(scan.total).toBe(MAX_REPORTED_LOOPS + 1);
    expect(scan.loops).toHaveLength(MAX_REPORTED_LOOPS);
    expect(scan.loopLinkIds.size).toBe((MAX_REPORTED_LOOPS + 1) * 2);
  });

  it('确定性：同一个世界扫两次，结果完全一致（D-07）', () => {
    const { a, b, host } = switchPair();
    const world = buildWorld(
      scenarioOf(
        [a, b, host],
        [
          cable('c1', 'cat6', 2, ['dev-a', 'port-ge1'], ['dev-b', 'port-ge1']),
          cable('c2', 'cat6', 2, ['dev-a', 'port-ge2'], ['dev-b', 'port-ge2']),
          cable('c3', 'cat6', 2, ['dev-a', 'port-ge3'], ['dev-b', 'port-ge3']),
          cable('c4', 'cat6', 2, ['dev-b', 'port-ge4'], ['dev-host', 'port-ge1']),
        ],
      ),
    );
    const first = detectL2Loops(world);
    const second = detectL2Loops(world);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
