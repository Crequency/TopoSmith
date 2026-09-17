/**
 * 命中测试单测（FR-48 的支撑改动）
 *
 * 机柜是**容器**：它的矩形把柜内设备整个罩住。如果命中判定只按"后画的先命中"遍历
 * （`world.ordered` 是 id 字典序，与 z 序无关），那么"能不能选中柜内设备""悬浮时淡出的是谁"
 * 就取决于设备 id 的字典序 —— 一个随 id 变化的行为不是行为，是巧合。
 */

import { describe, expect, it } from 'vitest';
import { instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, type Scenario } from '@toposmith/schema';
import { buildWorld } from '@toposmith/engine';
import { rackMountPosition } from '../../lib/geometry';
import { hitDevice } from '../draw';

/**
 * 造一个"机柜 + 柜内设备"的场景。
 * id 特意可调：用两组排序相反的 id 证明判定与字典序无关。
 */
function fixture(rackId: string, serverId: string) {
  const rack = instantiate('rack-24u', rackId, '机柜', 200, 120);
  const server = instantiate('server-rack', serverId, '服务器', 0, 0);
  server.mount = { rackId, startU: 1 };
  const position = rackMountPosition(rack, 1, 4);
  server.x = position.x;
  server.y = position.y;

  const scenario: Scenario = {
    schemaVersion: SCHEMA_VERSION,
    id: 'hit-fixture',
    name: 'hit fixture',
    devices: [rack, server],
    cables: [],
    updatedAt: '2026-09-17T00:00:00.000Z',
  };
  return { world: buildWorld(scenario), rack, server };
}

describe('命中测试：容器让位于具体设备', () => {
  it('指针落在柜内设备上 → 命中该设备而不是机柜', () => {
    const { world, server } = fixture('dev-rack', 'dev-srv');
    const hit = hitDevice(world, server.x + 40, server.y + 20);
    expect(hit?.id).toBe('dev-srv');
  });

  it('结果与 id 字典序无关（机柜排在设备前 / 后都一样）', () => {
    // 第一组：机柜 id 在前（"a-rack" < "z-srv"）
    const first = fixture('a-rack', 'z-srv');
    expect(hitDevice(first.world, first.server.x + 40, first.server.y + 20)?.id).toBe('z-srv');
    // 第二组：设备 id 在前（"a-srv" < "z-rack"）
    const second = fixture('z-rack', 'a-srv');
    expect(hitDevice(second.world, second.server.x + 40, second.server.y + 20)?.id).toBe('a-srv');
  });

  it('指针落在机柜的空白处（柜内无设备的位置）→ 命中机柜', () => {
    const { world, rack, server } = fixture('dev-rack', 'dev-srv');
    // 服务器占 1–4U，取第 20U 的空白位置
    const emptySlot = rackMountPosition(rack, 20, 4);
    expect(hitDevice(world, emptySlot.x + 40, emptySlot.y + 20)?.id).toBe(rack.id);
    // 兜底：确认那个点确实不在服务器卡片上
    const inside =
      emptySlot.x + 40 >= server.x &&
      emptySlot.x + 40 <= server.x + 200 &&
      emptySlot.y + 20 >= server.y &&
      emptySlot.y + 20 <= server.y + 200;
    expect(inside).toBe(false);
  });

  it('指针落在空白画布 → 什么都命中不到', () => {
    const { world } = fixture('dev-rack', 'dev-srv');
    expect(hitDevice(world, -5000, -5000)).toBeUndefined();
  });
});
