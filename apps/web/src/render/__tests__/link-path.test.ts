/** 端口到端口的连线路由单测（FR-33）+ 标签位置（FR-46） */

import { describe, expect, it } from 'vitest';
import { instantiate } from '@toposmith/catalog';
import { MAX_LABEL_RATIO, SCHEMA_VERSION, type Scenario } from '@toposmith/schema';
import { buildWorld } from '@toposmith/anvil';
import { NODE_H, NODE_W } from '../../lib/geometry';
import { portGlyphOf } from '../../lib/ports';
import { nearestRatio } from '../../lib/polyline';
import { cableLabelRect, cableLabelVisible, hitCableLabel, linkPath } from '../draw';

function fixture() {
  const sw = instantiate('switch-8-1g', 'dev-sw', '交换机', 100, 100);
  const pc = instantiate('pc-desktop', 'dev-pc', '台式机', 520, 320);
  const scenario: Scenario = {
    schemaVersion: SCHEMA_VERSION,
    id: 'link-fixture',
    name: 'link fixture',
    devices: [sw, pc],
    cables: [
      {
        id: 'c1',
        type: 'cat6',
        lengthM: 10,
        a: { deviceId: sw.id, portId: 'port-ge1' },
        b: { deviceId: pc.id, portId: 'port-ge1' },
      },
    ],
    updatedAt: '2026-09-17T00:00:00.000Z',
  };
  const world = buildWorld(scenario);
  return { sw, pc, world, link: world.links[0]! };
}

describe('端口到端口的连线路由', () => {
  it('起点与终点分别落在两端端口图元的正下方（卡片底边）', () => {
    const { sw, pc, world, link } = fixture();
    const path = linkPath(world, link)!;
    const glyphA = portGlyphOf(sw, 'port-ge1')!;
    const glyphB = portGlyphOf(pc, 'port-ge1')!;

    const start = path.points[0]!;
    const end = path.points[path.points.length - 1]!;
    expect(start.x).toBeCloseTo(glyphA.centerX, 5);
    expect(start.y).toBeCloseTo(sw.y + NODE_H, 5);
    expect(end.x).toBeCloseTo(glyphB.centerX, 5);
    expect(end.y).toBeCloseTo(pc.y + NODE_H, 5);
  });

  it('路径是下垂的电缆曲线，而不是穿过卡片中心的直线', () => {
    const { sw, pc, world, link } = fixture();
    const path = linkPath(world, link)!;
    const bottom = Math.max(sw.y + NODE_H, pc.y + NODE_H);
    const lowest = Math.max(...path.points.map((point) => point.y));
    expect(lowest).toBeGreaterThan(bottom + 8);
  });

  it('不同端口接入点不同 —— 这是"端口到端口"而非"设备到设备"的关键', () => {
    const { sw, world, link } = fixture();
    const path = linkPath(world, link)!;
    const ge1 = portGlyphOf(sw, 'port-ge1')!;
    const ge8 = portGlyphOf(sw, 'port-ge8')!;
    expect(Math.abs(ge8.centerX - ge1.centerX)).toBeGreaterThan(10);
    expect(path.points[0]!.x).not.toBeCloseTo(ge8.centerX, 3);
    // 设备中心也不该是接入点
    expect(path.points[0]!.x).not.toBeCloseTo(sw.x + NODE_W / 2, 3);
  });

  it('曲线采样点足够密（动画与命中测试都依赖它）', () => {
    const { world, link } = fixture();
    const path = linkPath(world, link)!;
    expect(path.points.length).toBeGreaterThanOrEqual(12);
    // 相邻采样点间距应远小于总跨度
    const span = Math.hypot(
      path.to.x - path.from.x,
      path.to.y - path.from.y,
    );
    const step = Math.hypot(
      path.points[1]!.x - path.points[0]!.x,
      path.points[1]!.y - path.points[0]!.y,
    );
    expect(step).toBeLessThan(span / 4);
  });
});

describe('连线标签位置（FR-46）', () => {
  const camera = { x: 0, y: 0, k: 1 };

  it('缺省标签落在弧长中点（与 mid 重合）', () => {
    const { world, link } = fixture();
    const path = linkPath(world, link)!;
    expect(path.labelPoint.x).toBeCloseTo(path.mid.x, 6);
    expect(path.labelPoint.y).toBeCloseTo(path.mid.y, 6);
  });

  it('labelRatio 让标签沿连线移动，且始终落在连线上', () => {
    const { world } = fixture();
    const cable = world.scenario.cables[0]!;
    const at = (ratio: number) => {
      const link = { ...world.links[0]!, cable: { ...cable, labelRatio: ratio } };
      const path = linkPath(world, link)!;
      // 标签必须贴在折线上：到折线的距离为 0
      const projection = nearestRatio(path.points, path.labelPoint);
      expect(projection.distance).toBeLessThan(0.5);
      return { point: path.labelPoint, ratio: projection.ratio, path };
    };

    const near = at(0.15);
    const mid = at(0.5);
    const far = at(0.85);
    expect(near.ratio).toBeCloseTo(0.15, 3);
    expect(far.ratio).toBeCloseTo(0.85, 3);
    // 位置确实不同（否则"拖动"就是假的）
    expect(Math.hypot(near.point.x - mid.point.x, near.point.y - mid.point.y)).toBeGreaterThan(10);
    expect(Math.hypot(far.point.x - mid.point.x, far.point.y - mid.point.y)).toBeGreaterThan(10);
  });

  it('越界的比例被钳制，标签不会跑到端口外面', () => {
    const { world } = fixture();
    const cable = world.scenario.cables[0]!;
    const path = linkPath(world, { ...world.links[0]!, cable: { ...cable, labelRatio: 9 } })!;
    const projection = nearestRatio(path.points, path.labelPoint);
    expect(projection.ratio).toBeLessThanOrEqual(MAX_LABEL_RATIO + 1e-6);
    expect(projection.ratio).toBeGreaterThan(0.5);
  });

  it('命中测试认标签的当前位置，且不再认旧位置', () => {
    const { world } = fixture();
    const cable = world.scenario.cables[0]!;
    const moved = { ...world.links[0]!, cable: { ...cable, labelRatio: 0.2 } };
    const movedWorld = { ...world, links: [moved] };

    const rect = cableLabelRect(movedWorld, moved, camera)!;
    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    expect(hitCableLabel(movedWorld, camera, center.x, center.y)?.id).toBe(moved.id);

    // 原中点处已经不该再命中（标签已经搬走了）
    const oldMid = linkPath(world, { ...world.links[0]!, cable })!.mid;
    const oldHit = hitCableLabel(movedWorld, camera, oldMid.x, oldMid.y);
    expect(oldHit?.id).not.toBe(moved.id);
  });

  it('缩放后标签是固定屏幕尺寸：命中框按 1/k 反向放大', () => {
    const { world, link } = fixture();
    const at1 = cableLabelRect(world, link, { x: 0, y: 0, k: 1 })!;
    const at2 = cableLabelRect(world, link, { x: 0, y: 0, k: 2 })!;
    // 世界尺寸减半，屏幕上看起来一样大
    expect(at2.w).toBeCloseTo(at1.w / 2, 4);
    expect(at2.h).toBeCloseTo(at1.h / 2, 4);
  });
});

describe('速率标签的可见性与命中一致（FR-56）', () => {
  it('缩得太小时标签不画 —— 也就不该被点到（否则点设备会变成拖标签）', () => {
    const { world } = fixture();
    const link = world.links[0]!;
    const far = { x: 0, y: 0, k: 0.1 }; // 远低于 LOD 阈值
    expect(cableLabelVisible(link.id, far)).toBe(false);
    const rect = cableLabelRect(world, link, far)!;
    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    expect(hitCableLabel(world, far, center.x, center.y)).toBeUndefined();
    // 放大回正常比例后又能点到
    const near = { x: 0, y: 0, k: 1 };
    const rect1 = cableLabelRect(world, link, near)!;
    expect(hitCableLabel(world, near, rect1.x + rect1.w / 2, rect1.y + rect1.h / 2)?.id).toBe(link.id);
  });

  it('被强调的标签（选中 / 在诊断路径上）在低缩放下依然可见可点', () => {
    const { world } = fixture();
    const link = world.links[0]!;
    const far = { x: 0, y: 0, k: 0.1 };
    expect(cableLabelVisible(link.id, far, [link.id])).toBe(true);
    const rect = cableLabelRect(world, link, far)!;
    expect(
      hitCableLabel(world, far, rect.x + rect.w / 2, rect.y + rect.h / 2, undefined, [link.id])?.id,
    ).toBe(link.id);
  });
});
