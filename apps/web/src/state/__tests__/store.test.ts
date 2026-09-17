/**
 * store 行为单测
 *
 * zustand store 在 Node 下可直接驱动（localStorage / matchMedia 都有存在性判断），
 * 于是"选中的最后两台设备填入诊断""端口增删""机柜挂载"这些跨模块逻辑可以真正被断言，
 * 而不是只靠浏览器手点。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LABEL_RATIO,
  MAX_LABEL_RATIO,
  MIN_LABEL_RATIO,
  clampLabelRatio,
} from '@toposmith/schema';
import { useApp } from '../store';

const state = () => useApp.getState();
const addressOf = (deviceId: string) => state().world.addresses.get(deviceId)?.[0]?.ip ?? '';

beforeEach(() => {
  state().resetScenario();
});

describe('多选与连通性诊断联动（FR-35）', () => {
  it('保持点击顺序，并把最后两台填入诊断：先选中的是源设备', () => {
    state().selectOneDevice('dev-pc');
    state().toggleDevice('dev-nas');
    state().toggleDevice('dev-srv');

    const current = state();
    expect(current.selection.devices).toEqual(['dev-pc', 'dev-nas', 'dev-srv']);
    // 最后两台 = dev-nas（源）→ dev-srv（目标）
    expect(current.diag.srcId).toBe('dev-nas');
    expect(current.diag.dstIp).toBe(addressOf('dev-srv'));
    expect(current.diag.fromSelection).toEqual({ srcId: 'dev-nas', dstId: 'dev-srv' });
  });

  it('再次 Ctrl 点击会切换选中，并重新取"最后两台"', () => {
    state().selectOneDevice('dev-pc');
    state().toggleDevice('dev-nas');
    expect(state().diag.srcId).toBe('dev-pc');
    expect(state().diag.dstIp).toBe(addressOf('dev-nas'));

    // 再点一次 dev-pc 取消它 → 只剩 dev-nas，不再联动
    state().toggleDevice('dev-pc');
    expect(state().selection.devices).toEqual(['dev-nas']);
    expect(state().diag.fromSelection).toBeUndefined();
  });

  it('清空选择会移除"来自选中设备"标记', () => {
    state().selectOneDevice('dev-pc');
    state().toggleDevice('dev-nas');
    expect(state().diag.fromSelection).toBeDefined();
    state().clearSelection();
    expect(state().diag.fromSelection).toBeUndefined();
  });
});

describe('端口增删（FR-38）', () => {
  it('添加端口：名字按介质递增、id 唯一、默认速率与角色正确', () => {
    const before = state().world.devices.get('dev-sw')!.ports.length;
    state().addPort('dev-sw', { medium: 'rj45' });
    const ports = state().world.devices.get('dev-sw')!.ports;
    expect(ports.length).toBe(before + 1);
    const added = ports[ports.length - 1]!;
    expect(added.medium).toBe('rj45');
    expect(added.speedMbps).toBe(1000);
    expect(added.side).toBe('front');
    expect(new Set(ports.map((port) => port.id)).size).toBe(ports.length);
  });

  it('添加背面光口时带默认模块与角色', () => {
    state().addPort('dev-srv', { medium: 'sfp', side: 'rear' });
    const ports = state().world.devices.get('dev-srv')!.ports;
    const added = ports[ports.length - 1]!;
    expect(added.side).toBe('rear');
    expect(added.role).toBe('uplink');
    expect(added.module).toBe('SFP+ 10G');
  });

  it('删除端口会连带移除挂在其上的连线', () => {
    const attached = state().world.linksByPort.get('dev-sw:port-ge2') ?? [];
    expect(attached.length).toBe(1);
    state().removePort('dev-sw', 'port-ge2');

    const after = state();
    expect(after.world.devices.get('dev-sw')!.ports.some((p) => p.id === 'port-ge2')).toBe(false);
    expect(after.scenario.cables.some((cable) => cable.id === attached[0]!.id)).toBe(false);
  });

  it('删除端口会同时清掉绑在该端口上的三层接口', () => {
    state().removePort('dev-ont', 'port-ge1');
    const ont = state().world.devices.get('dev-ont')!;
    expect(ont.l3.interfaces.some((itf) => itf.portId === 'port-ge1')).toBe(false);
  });

  it('不允许删掉最后一个端口', () => {
    const pc = state().world.devices.get('dev-pc')!;
    expect(pc.ports.length).toBe(1);
    state().removePort('dev-pc', pc.ports[0]!.id);
    expect(state().world.devices.get('dev-pc')!.ports.length).toBe(1);
    expect(state().toast?.level).toBe('warn');
  });

  it('端口增删可撤销', () => {
    state().addPort('dev-sw', { medium: 'pon' });
    const withPort = state().world.devices.get('dev-sw')!.ports.length;
    state().undo();
    expect(state().world.devices.get('dev-sw')!.ports.length).toBe(withPort - 1);
  });
});

describe('机柜容器（FR-36）', () => {
  const addRack = () => {
    state().addDevice('rack-24u', 100, 100);
    return state().selection.devices[0]!;
  };

  it('上架：写入挂载关系并把设备移动到对应 U 位', () => {
    const rackId = addRack();
    state().mountDevice('dev-srv', rackId);
    const server = state().world.devices.get('dev-srv')!;
    expect(server.mount).toEqual({ rackId, startU: 1 });
    const rack = state().world.devices.get(rackId)!;
    expect(server.x).toBeGreaterThan(rack.x);
    expect(server.y).toBeGreaterThan(rack.y);
  });

  it('多台设备按各自 U 数依次占用 U 位（默认 4U，所以第二台从第 5U 起）', () => {
    const rackId = addRack();
    state().mountDevice('dev-srv', rackId); // 4U → 1–4
    state().mountDevice('dev-sw', rackId); // 4U → 5–8
    expect(state().world.devices.get('dev-srv')!.mount?.startU).toBe(1);
    expect(state().world.devices.get('dev-sw')!.mount?.startU).toBe(5);
  });

  it('机柜移动时柜内设备一起移动（相对位置不变）', () => {
    const rackId = addRack();
    state().mountDevice('dev-srv', rackId);
    const server = state().world.devices.get('dev-srv')!;
    const rack = state().world.devices.get(rackId)!;
    const offset = { x: server.x - rack.x, y: server.y - rack.y };

    state().moveDevices([{ deviceId: rackId, x: rack.x + 200, y: rack.y + 120 }], {
      mergeKey: undefined,
    });

    const after = state().world.devices.get('dev-srv')!;
    const movedRack = state().world.devices.get(rackId)!;
    expect(after.x - movedRack.x).toBe(offset.x);
    expect(after.y - movedRack.y).toBe(offset.y);
  });

  it('把设备拖出机柜会自动下架', () => {
    const rackId = addRack();
    state().mountDevice('dev-srv', rackId);
    state().moveDevices([{ deviceId: 'dev-srv', x: 2000, y: 2000 }], { mergeKey: undefined });
    expect(state().world.devices.get('dev-srv')!.mount).toBeUndefined();
  });

  it('调低高度后放不下的设备自动下架', () => {
    const rackId = addRack();
    state().mountDevice('dev-srv', rackId); // 4U
    state().mountDevice('dev-sw', rackId); // 4U
    state().mountDevice('dev-olt', rackId); // 8U
    expect(state().world.ordered.filter((d) => d.mount?.rackId === rackId)).toHaveLength(3);

    // 机柜降到最小高度 8U：两台 4U 设备装得下，8U 的 OLT 装不下
    state().setRackHeight(rackId, 4); // 会被钳制到最小 8U
    const stillMounted = state().world.ordered.filter((d) => d.mount?.rackId === rackId);
    expect(stillMounted.map((d) => d.id).sort()).toEqual(['dev-srv', 'dev-sw']);
    expect(state().world.devices.get('dev-olt')!.mount).toBeUndefined();
  });

  it('翻转机柜不进入撤销历史（视角切换不是拓扑变更）', () => {
    const rackId = addRack();
    state().flipRack(rackId);
    expect(state().world.devices.get(rackId)!.rack?.flipped).toBe(true);
    // 撤销掉的应当是"添加机柜"，而不是把机柜翻回来
    state().undo();
    expect(state().world.devices.get(rackId)).toBeUndefined();
  });

  it('非机架式设备不能上架', () => {
    const rackId = addRack();
    state().mountDevice('dev-nas', rackId);
    expect(state().world.devices.get('dev-nas')!.mount).toBeUndefined();
    expect(state().toast?.level).toBe('warn');
  });

  it('删除机柜后柜内设备下架但保留在画布上', () => {
    const rackId = addRack();
    state().mountDevice('dev-srv', rackId);
    state().selectOneDevice(rackId);
    state().deleteSelection();
    const server = state().world.devices.get('dev-srv');
    expect(server).toBeDefined();
    expect(server!.mount).toBeUndefined();
  });
});

describe('多 U 设备（FR-39）', () => {
  const addRack = () => {
    state().addDevice('rack-24u', 100, 100);
    return state().selection.devices[0]!;
  };

  it('默认 4U（一张卡片 = 4U），OLT 作为框式设备默认 8U', () => {
    expect(state().world.devices.get('dev-srv')!.rackUnits).toBe(4);
    expect(state().world.devices.get('dev-sw')!.rackUnits).toBe(4);
    expect(state().world.devices.get('dev-olt')!.rackUnits).toBe(8);
  });

  it('后续设备会跳过被 8U 设备占用的 U 位，从第 9U 开始', () => {
    const rackId = addRack();
    state().mountDevice('dev-olt', rackId); // 8U → 1–8
    state().mountDevice('dev-srv', rackId); // 4U → 应从 9U 起
    expect(state().world.devices.get('dev-srv')!.mount?.startU).toBe(9);
  });

  it('把已上架设备从 4U 改成 8U 会重新找一个装得下的位置', () => {
    const rackId = addRack();
    state().mountDevice('dev-srv', rackId); // 4U → 1–4
    state().mountDevice('dev-sw', rackId); // 4U → 5–8
    expect(state().world.devices.get('dev-srv')!.mount?.startU).toBe(1);
    expect(state().world.devices.get('dev-sw')!.mount?.startU).toBe(5);

    state().setDeviceRackUnits('dev-srv', 8);
    const server = state().world.devices.get('dev-srv')!;
    expect(server.rackUnits).toBe(8);
    // 1–4U 放不下 8U，需绕开已占的 5–8U，落到 9U
    expect(server.mount?.startU).toBe(9);
  });

  it('机柜装不下新高度时自动下架并提示', () => {
    state().addDevice('rack-24u', 100, 100);
    const rackId = state().selection.devices[0]!;
    state().setRackHeight(rackId, 8); // 最小 8U 机柜
    state().mountDevice('dev-srv', rackId); // 4U → 占 1–4
    state().setDeviceRackUnits('dev-srv', 12); // 8U 机柜放不下 12U
    const server = state().world.devices.get('dev-srv')!;
    expect(server.rackUnits).toBe(12);
    expect(server.mount).toBeUndefined();
    expect(state().toast?.level).toBe('warn');
  });

  it('未上架设备也能改 U 高（卡片高度随之变化）', () => {
    state().setDeviceRackUnits('dev-olt', 12);
    const olt = state().world.devices.get('dev-olt')!;
    expect(olt.rackUnits).toBe(12);
    expect(olt.mount).toBeUndefined();
  });

  it('U 高钳制在 4–24（面板放不下更小的卡片）', () => {
    state().setDeviceRackUnits('dev-olt', 99);
    expect(state().world.devices.get('dev-olt')!.rackUnits).toBe(24);
    state().setDeviceRackUnits('dev-olt', 1);
    expect(state().world.devices.get('dev-olt')!.rackUnits).toBe(4);
  });

  it('设备翻转切换自身观察面；上架设备的观察面跟随机柜（FR-40）', () => {
    // 未上架：翻转自己
    state().flipDevice('dev-srv');
    expect(state().world.devices.get('dev-srv')!.flipped).toBe(true);
    state().flipDevice('dev-srv');
    expect(state().world.devices.get('dev-srv')!.flipped).toBe(false);

    // 上架后：翻转机柜即翻转柜内设备（设备自身标记不变）
    const rackId = addRack();
    state().mountDevice('dev-srv', rackId);
    state().flipRack(rackId);
    expect(state().world.devices.get(rackId)!.rack?.flipped).toBe(true);
    expect(state().world.devices.get('dev-srv')!.flipped).toBe(false);
  });
});

describe('节点 id 唯一性（FR-45）', () => {
  it('同一毫秒内连续添加同型号设备，id 必须互不相同', () => {
    state().clearScenario();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      state().addDevice('pc-desktop', 100 + i * 40, 100);
      ids.push(state().selection.devices[0]!);
    }
    expect(new Set(ids).size).toBe(5);
    expect(state().world.ordered).toHaveLength(5);
    // world 是 Map，不会互相覆盖
    expect(new Set(state().world.ordered.map((d) => d.id)).size).toBe(5);
  });

  it('连续创建多条连线，id 也互不相同', () => {
    state().clearScenario();
    state().addDevice('switch-8-1g', 100, 100);
    const sw = state().selection.devices[0]!;
    const pcIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      state().addDevice('pc-desktop', 400 + i * 200, 100);
      pcIds.push(state().selection.devices[0]!);
    }
    pcIds.forEach((pcId, index) => {
      state().clickPort(sw, `port-ge${index + 1}`);
      state().clickPort(pcId, 'port-ge1');
    });
    const cableIds = state().scenario.cables.map((cable) => cable.id);
    expect(cableIds).toHaveLength(3);
    expect(new Set(cableIds).size).toBe(3);
  });
});

describe('连线标签位置（FR-46）', () => {
  it('patchCable 保存的是弧长比例，拖动整段只记一条历史', () => {
    const cableId = state().scenario.cables[0]!.id;
    const before = state().scenario.cables.find((c) => c.id === cableId)!.labelRatio;

    // 模拟拖动：beginHistory 之后连续多次 patch，undo 应该一步回到原点
    state().beginHistory('调整标签位置');
    for (const ratio of [0.3, 0.2, 0.15]) {
      state().patchCable(cableId, { labelRatio: ratio });
    }
    state().commitHistory();

    expect(state().scenario.cables.find((c) => c.id === cableId)!.labelRatio).toBe(0.15);
    state().undo();
    expect(state().scenario.cables.find((c) => c.id === cableId)!.labelRatio).toBe(before);
    state().redo();
    expect(state().scenario.cables.find((c) => c.id === cableId)!.labelRatio).toBe(0.15);
  });

  it('标签位置是纯展示属性：改动它不改变任何诊断结论', () => {
    const cableId = state().scenario.cables[0]!.id;
    const linksBefore = state().world.links.map((link) => `${link.id}:${link.up}:${link.speedMbps}`);
    state().patchCable(cableId, { labelRatio: 0.1 });
    const linksAfter = state().world.links.map((link) => `${link.id}:${link.up}:${link.speedMbps}`);
    expect(linksAfter).toEqual(linksBefore);
  });

  it('非法比例（越界 / 非数字）在读回时被钳制或回落到默认值', () => {
    expect(clampLabelRatio(0.5)).toBe(0.5);
    expect(clampLabelRatio(-2)).toBe(MIN_LABEL_RATIO);
    expect(clampLabelRatio(7)).toBe(MAX_LABEL_RATIO);
    expect(clampLabelRatio(undefined)).toBe(DEFAULT_LABEL_RATIO);
    expect(clampLabelRatio(Number.NaN)).toBe(DEFAULT_LABEL_RATIO);
  });
});

describe('拖动设备的快速路径（FR-56）', () => {
  it('位置变化不影响任何派生数据：快速路径与完整重建结果一致', () => {
    const before = state().world;
    const linksBefore = before.links.map((l) => `${l.id}:${l.up}:${l.speedMbps}`);
    const addressesBefore = [...before.addresses.entries()]
      .map(([id, list]) => `${id}=${list.map((a) => a.ip).join(',')}`)
      .join('|');

    state().moveDevices([{ deviceId: 'dev-pc', x: 1234, y: 567 }], { label: '移动设备' });
    const after = state().world;

    // 坐标确实改了
    expect(after.devices.get('dev-pc')?.x).toBe(1234);
    // 而派生数据一模一样（这正是"位置可以走快路径"的依据）
    expect(after.links.map((l) => `${l.id}:${l.up}:${l.speedMbps}`)).toEqual(linksBefore);
    expect(
      [...after.addresses.entries()]
        .map(([id, list]) => `${id}=${list.map((a) => a.ip).join(',')}`)
        .join('|'),
    ).toBe(addressesBefore);
  });

  it('快速路径下世界里的设备对象与场景保持同一批引用（否则画布会画旧坐标）', () => {
    state().moveDevices([{ deviceId: 'dev-nas', x: 800, y: 900 }], { label: '移动设备' });
    const current = state();
    const fromWorld = current.world.devices.get('dev-nas');
    const fromScenario = current.scenario.devices.find((d) => d.id === 'dev-nas');
    expect(fromWorld).toBe(fromScenario);
    expect(fromWorld?.x).toBe(800);
  });

  it('拖动事务提交后落盘一次，撤销能回到拖动前', () => {
    const originX = state().scenario.devices.find((d) => d.id === 'dev-pc')!.x;
    state().beginHistory('移动设备');
    state().moveDevices([{ deviceId: 'dev-pc', x: originX + 40, y: 200 }], { label: '移动设备' });
    state().moveDevices([{ deviceId: 'dev-pc', x: originX + 80, y: 240 }], { label: '移动设备' });
    state().commitHistory();
    expect(state().scenario.devices.find((d) => d.id === 'dev-pc')!.x).toBe(originX + 80);
    state().undo();
    expect(state().scenario.devices.find((d) => d.id === 'dev-pc')!.x).toBe(originX);
  });
});

describe('预置场景载入（FR-54）', () => {
  it('载入会把整个场景换掉、清空选择与历史，并写入存档', () => {
    state().loadPreset('datacenter');
    const after = state();
    expect(after.scenario.name).toContain('机房机柜');
    expect(after.selection.devices).toHaveLength(0);
    expect(after.selection.cables).toHaveLength(0);
    expect(after.linkDraft).toBeNull();
    // 换场景是一次"重新开始"：不能撤销回上一个场景
    expect(after.history.canUndo).toBe(false);
    expect(after.scenario.devices.length).toBeGreaterThan(8);
  });

  it('每个预置场景都能载入，且载入后世界与场景一致', () => {
    for (const key of ['home', 'office', 'datacenter', 'ftth', 'campus']) {
      state().loadPreset(key);
      const current = state();
      expect(current.world.ordered).toHaveLength(current.scenario.devices.length);
      expect(current.world.links).toHaveLength(current.scenario.cables.length);
    }
  });

  it('未知 key 不会破坏当前场景，只给一条警告', () => {
    state().loadPreset('office');
    const before = state().scenario;
    state().loadPreset('nope-not-a-preset');
    expect(state().scenario).toBe(before);
    expect(state().toast?.level).toBe('warn');
  });
});

describe('网格吸附（FR-37）', () => {
  it('开启吸附时新设备落在 8 单位网格上', () => {
    state().setSnapEnabled(true);
    state().addDevice('pc-desktop', 103, 507);
    // ordered 按 id 排序，所以用"刚添加后被选中的那台"来断言
    const device = state().world.devices.get(state().selection.devices[0]!)!;
    expect(device.x % 8).toBe(0);
    expect(device.y % 8).toBe(0);
  });

  it('关闭吸附时保留原始落点', () => {
    state().setSnapEnabled(false);
    state().addDevice('pc-desktop', 103, 507);
    const device = state().world.devices.get(state().selection.devices[0]!)!;
    expect(device.x).toBe(103);
    expect(device.y).toBe(507);
    state().setSnapEnabled(true);
  });
});

describe('链路聚合开关（FR-66）', () => {
  const bondedIds = () =>
    state()
      .scenario.cables.filter((cable) => cable.bonded)
      .map((cable) => cable.id)
      .sort();

  it('勾选一次就把「同一对设备之间」的所有线缆标成聚合，并且只记一条历史', () => {
    state().loadPreset('loop');
    expect(bondedIds()).toEqual([]);
    expect(state().world.loops).toHaveLength(3);

    state().setBonded('cbl-redundant-1', true);

    // 聚合是"一对设备之间的组"：同对端的另一根必须一起标上
    expect(bondedIds()).toEqual(['cbl-redundant-1', 'cbl-redundant-2']);
    // 双上行聚合成一条逻辑链路 → 少一处环（另外两处是自环跳线与无线中继）
    expect(state().world.loops).toHaveLength(2);
    // 不会误伤别的链路（别的线缆一根都没被标上）
    expect(state().scenario.cables.find((cable) => cable.id === 'cbl-core-a')?.bonded).toBeUndefined();
    expect(bondedIds()).toHaveLength(2);

    // 一次撤销回到"三处环"的原始状态
    state().undo();
    expect(bondedIds()).toEqual([]);
    expect(state().world.loops).toHaveLength(3);
  });

  it('解除聚合会把整组标记清掉，不会留下单成员聚合', () => {
    state().loadPreset('loop');
    state().setBonded('cbl-redundant-2', true);
    expect(bondedIds()).toEqual(['cbl-redundant-1', 'cbl-redundant-2']);

    state().setBonded('cbl-redundant-2', false);
    expect(bondedIds()).toEqual([]);
    expect(state().world.loops).toHaveLength(3);
  });

  it('聚合不改变可达性：办公段到服务器段依然通', () => {
    state().loadPreset('loop');
    state().setBonded('cbl-redundant-1', true);
    expect(state().world.loops).toHaveLength(2);
    state().setDiagSrc('dev-pc1');
    state().setDiagDst('192.168.20.10');
    state().runDiag('ping');
    expect(state().diag.result?.ok).toBe(true);
  });
});

describe('侧栏布局与命令菜单（FR-69 / FR-70 / FR-71）', () => {
  const layout = () => state().uiLayout;

  it('拖侧栏宽度：改的是使用偏好，不进拓扑的撤销栈（落盘由端到端验证）', () => {
    state().setSidebarWidth('left', 300);
    expect(layout().leftWidth).toBe(300);
    expect(state().history.canUndo).toBe(false);
  });

  it('宽度被夹在合法区间内（存档/脚本直接写入也安全）', () => {
    state().setSidebarWidth('left', 10);
    expect(layout().leftWidth).toBeGreaterThanOrEqual(180);
    state().setSidebarWidth('left', 100000);
    expect(layout().leftWidth).toBeLessThanOrEqual(560);
  });

  it('卡片可以在本侧栏内换位，也可以换到另一侧栏', () => {
    state().moveCard('tree', 'left', 0);
    expect(layout().left[0]).toBe('tree');

    state().moveCard('tree', 'right', 0);
    expect(layout().right[0]).toBe('tree');
    expect(layout().left).not.toContain('tree');

    // 卡片不会重复、也不会丢
    const all = [...layout().left, ...layout().right];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(10);
  });

  it('折叠状态可切换；节点树默认折叠（全量列表不常驻）', () => {
    expect(layout().collapsed['tree']).toBe(true);
    state().toggleCardCollapsed('tree');
    expect(layout().collapsed['tree']).toBeUndefined();
    state().toggleCardCollapsed('tree');
    expect(layout().collapsed['tree']).toBe(true);
  });

  it('分割比例以权重形式保存（FR-60 的行为被推广）', () => {
    state().setCardWeights({ inspector: 3, diagnostics: 1 });
    expect(layout().weights).toEqual({ inspector: 3, diagnostics: 1 });
    // 其余卡片仍保留自己的权重（只改被拖的那一对）
    state().setCardWeights({ inspector: 1.1, diagnostics: 1.4 });
    expect(layout().weights['inspector']).toBe(1.1);
  });

  it('重置布局：卡片顺序与折叠回到默认，宽度保留（宽度是当前窗口下的体感）', () => {
    state().setSidebarWidth('left', 320);
    state().moveCard('tree', 'right', 0);
    state().toggleCardCollapsed('tree');
    state().resetLayout();
    expect(layout().right).toEqual(['inspector', 'diagnostics']);
    expect(layout().left).toContain('tree');
    expect(layout().collapsed).toEqual({ tree: true });
    expect(layout().leftWidth).toBe(320);
  });

  it('拖拽现场状态：begin / target / end 三步，落点为空时不改布局', () => {
    expect(state().draggingCard).toBeNull();
    state().beginCardDrag('tree', 'left');
    expect(state().draggingCard).toEqual({ cardId: 'tree', side: 'left' });
    state().setCardDropTarget({ side: 'right', index: 1 });
    expect(state().cardDropTarget).toEqual({ side: 'right', index: 1 });
    state().endCardDrag();
    expect(state().draggingCard).toBeNull();
    expect(state().cardDropTarget).toBeNull();
  });

  it('命令菜单：打开 / 关闭 / 切换（Ctrl+Shift+P 走的是切换语义）', () => {
    expect(state().paletteOpen).toBe(false);
    state().openPalette();
    expect(state().paletteOpen).toBe(true);
    state().togglePalette();
    expect(state().paletteOpen).toBe(false);
    state().togglePalette();
    expect(state().paletteOpen).toBe(true);
    state().closePalette();
    expect(state().paletteOpen).toBe(false);
  });
});
