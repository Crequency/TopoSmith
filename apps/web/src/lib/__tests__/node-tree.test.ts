/** 节点树单测（FR-43）：嵌套、排序、过滤 */

import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type Scenario } from '@toposmith/schema';
import { instantiate } from '@toposmith/catalog';
import { buildWorld, type World } from '@toposmith/engine';
import {
  buildNodeRows,
  filterNodeRows,
  rackRangeText,
  rackUsageText,
  sortNodeRows,
} from '../node-tree';

function fixture(): World {
  const rack = instantiate('rack-24u', 'dev-rack', '机柜 A', 100, 100);
  const server = instantiate('server-rack', 'dev-srv', '服务器', 200, 200);
  const sw = instantiate('switch-8-1g', 'dev-sw', '交换机', 400, 200);
  const olt = instantiate('olt', 'dev-olt', 'OLT', 200, 400);
  const pc = instantiate('pc-desktop', 'dev-pc', '台式机', 600, 200);
  pc.client = { mode: 'static', ip: '192.168.1.50', prefix: 24, dns: [] };
  const scenario: Scenario = {
    schemaVersion: SCHEMA_VERSION,
    id: 'tree',
    name: 'tree',
    devices: [rack, server, sw, olt, pc],
    cables: [
      {
        id: 'c1',
        type: 'cat6',
        lengthM: 5,
        a: { deviceId: sw.id, portId: 'port-ge1' },
        b: { deviceId: pc.id, portId: 'port-ge1' },
      },
    ],
    updatedAt: '2026-09-17T00:00:00.000Z',
  };
  // 手动挂载：服务器 1U 起（4U）、交换机 5U 起（4U）、OLT 9U 起（8U）
  server.mount = { rackId: rack.id, startU: 1 };
  sw.mount = { rackId: rack.id, startU: 5 };
  olt.mount = { rackId: rack.id, startU: 9 };
  return buildWorld(scenario);
}

describe('节点树构建', () => {
  it('机柜作为父节点，柜内设备按 U 位紧随其后并缩进', () => {
    const rows = buildNodeRows(fixture());
    const rackIndex = rows.findIndex((row) => row.deviceId === 'dev-rack');
    expect(rackIndex).toBe(0);
    // 机柜后紧跟三台柜内设备，且 depth = 1
    const children = rows.slice(rackIndex + 1, rackIndex + 4);
    expect(children.map((row) => row.deviceId)).toEqual(['dev-srv', 'dev-sw', 'dev-olt']);
    expect(children.every((row) => row.depth === 1)).toBe(true);
    // 台式机不在机柜里，depth = 0 且排在最后
    const pc = rows.find((row) => row.deviceId === 'dev-pc')!;
    expect(pc.depth).toBe(0);
  });

  it('行内带上查看所需的信息：端口数、连接数、IP、U 区间、机柜占用', () => {
    const rows = buildNodeRows(fixture());
    const rackRow = rows.find((row) => row.deviceId === 'dev-rack')!;
    expect(rackUsageText(rackRow)).toBe('16/24U 已用');

    const serverRow = rows.find((row) => row.deviceId === 'dev-srv')!;
    expect(serverRow.rackName).toBe('机柜 A');
    expect(rackRangeText(serverRow)).toBe('1–4U');
    expect(serverRow.rackable).toBe(true);

    const pcRow = rows.find((row) => row.deviceId === 'dev-pc')!;
    expect(pcRow.ip).toBe('192.168.1.50');
    expect(pcRow.linkCount).toBe(1);
    expect(pcRow.rackable).toBe(false);
    expect(rackRangeText(pcRow)).toBe('');
  });
});

describe('节点树排序', () => {
  it('按名称排序时，机柜与柜内设备始终相邻（不会把子设备拆散）', () => {
    const sorted = sortNodeRows(buildNodeRows(fixture()), 'name', 'asc');
    const ids = sorted.map((row) => row.deviceId);
    const rackIndex = ids.indexOf('dev-rack');
    // 机柜与它的三个子设备必须连续
    expect(ids.slice(rackIndex, rackIndex + 4)).toEqual(['dev-rack', 'dev-srv', 'dev-sw', 'dev-olt']);
  });

  it('按连接数排序：有连线的设备排在没连线的前面', () => {
    const sorted = sortNodeRows(buildNodeRows(fixture()), 'links', 'desc');
    expect(sorted[0]!.deviceId === 'dev-sw' || sorted[0]!.deviceId === 'dev-pc').toBe(true);
    expect(sorted[0]!.linkCount).toBe(1);
  });

  it('按 IP 排序：无地址的设备始终排在最后（不随方向翻转）', () => {
    const asc = sortNodeRows(buildNodeRows(fixture()), 'ip', 'asc');
    const ascIps = asc.map((row) => row.ip);
    expect(ascIps.indexOf('192.168.1.50')).toBe(0);
    expect(ascIps.filter((ip) => ip === undefined).length).toBeGreaterThan(0);

    const desc = sortNodeRows(buildNodeRows(fixture()), 'ip', 'desc');
    const last = desc[desc.length - 1]!;
    // 反向后，无地址的仍在最后
    expect(last.ip).toBeUndefined();
  });

  it('按画布位置排序：从上到下、从左到右', () => {
    const sorted = sortNodeRows(buildNodeRows(fixture()), 'position', 'asc');
    const ys = sorted.map((row) => row.y);
    expect(ys[0]).toBeLessThanOrEqual(ys[ys.length - 1]!);
  });
});

describe('节点树过滤', () => {
  it('按名称/类型/IP 过滤，并在子设备命中时带出它的机柜', () => {
    const rows = buildNodeRows(fixture());
    // 子设备命中时带出机柜，且**机柜在前**（保持父子顺序）
    expect(filterNodeRows(rows, '交换机').map((row) => row.deviceId)).toEqual(['dev-rack', 'dev-sw']);
    expect(filterNodeRows(rows, '192.168.1.50').map((row) => row.deviceId)).toEqual(['dev-pc']);
    expect(filterNodeRows(rows, '服务器').map((row) => row.deviceId)).toEqual(['dev-rack', 'dev-srv']);
    expect(filterNodeRows(rows, '   ').length).toBe(rows.length);
  });
});
