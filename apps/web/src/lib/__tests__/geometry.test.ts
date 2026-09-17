/** 画布几何工具单测：对齐 / 分布 / 吸附 / 框选 */

import { describe, expect, it } from 'vitest';
import {
  NODE_H,
  NODE_W,
  RACK_EQUIPMENT_W,
  RACK_PAD_X,
  RACK_RAIL_W,
  RACK_UNIT_H,
  RACK_W,
  cardWidthOf,
  alignBoxes,
  boxIntersects,
  boxesBounds,
  cardHeightForUnits,
  cardHeightOf,
  computeSnap,
  distributeBoxes,
  findFreeSlot,
  normalizeBox,
  rackMountPosition,
  rackSlotContentBox,
  rackUnitsOf,
  snapToGrid,
  type Box,
} from '../geometry';

const box = (x: number, y: number, w = 152, h = 86): Box => ({ x, y, w, h });

describe('对齐', () => {
  it('左/右/水平居中对齐以选区包围盒为基准', () => {
    const boxes = [box(0, 0), box(100, 50), box(220, 100)];
    expect(alignBoxes(boxes, 'left').map((p) => p.x)).toEqual([0, 0, 0]);
    expect(alignBoxes(boxes, 'right').map((p) => p.x)).toEqual([220, 220, 220]);
    expect(alignBoxes(boxes, 'center-x').map((p) => p.x)).toEqual([110, 110, 110]);
    // 对齐不应改变另一轴
    expect(alignBoxes(boxes, 'left').map((p) => p.y)).toEqual([0, 50, 100]);
  });

  it('上/下/垂直居中对齐', () => {
    const boxes = [box(0, 0), box(0, 100), box(0, 300)];
    expect(alignBoxes(boxes, 'top').map((p) => p.y)).toEqual([0, 0, 0]);
    expect(alignBoxes(boxes, 'bottom').map((p) => p.y)).toEqual([300, 300, 300]);
    expect(alignBoxes(boxes, 'center-y').map((p) => p.y)).toEqual([150, 150, 150]);
  });

  it('空选集返回空数组（不抛异常）', () => {
    expect(alignBoxes([], 'left')).toEqual([]);
  });
});

describe('等间距分布', () => {
  it('首尾不动，中间项按相等间隙排布', () => {
    // 宽度都是 100：x = 0 / 40 / 500 → 总跨度 600，总宽 300，间隙 (600-300)/2 = 150
    const boxes = [box(0, 0, 100, 40), box(40, 0, 100, 40), box(500, 0, 100, 40)];
    const result = distributeBoxes(boxes, 'horizontal');
    expect(result.map((p) => p.x)).toEqual([0, 250, 500]);
  });

  it('垂直方向同理，且不改变另一轴', () => {
    const boxes = [box(10, 0, 100, 40), box(20, 30, 100, 40), box(30, 400, 100, 40)];
    const result = distributeBoxes(boxes, 'vertical');
    expect(result.map((p) => p.y)).toEqual([0, 200, 400]);
    expect(result.map((p) => p.x)).toEqual([10, 20, 30]);
  });

  it('少于 3 项时原样返回（没有可移动的中间项）', () => {
    const boxes = [box(0, 0), box(300, 0)];
    expect(distributeBoxes(boxes, 'horizontal').map((p) => p.x)).toEqual([0, 300]);
  });
});

describe('吸附', () => {
  it('靠近其他节点左边缘时吸附并给出引导线', () => {
    const moving = box(203, 500);
    const others = [box(200, 0)];
    const snap = computeSnap(moving, others, 7, null);
    expect(snap.dx).toBe(-3);
    expect(snap.guides.vertical).toEqual([200]);
  });

  it('边与中线之间也会吸附（按最近的一条参考线）', () => {
    // 另一台设备 y=100 h=86 → 参考线 100 / 143 / 186
    // 移动者 y=141 h=86 → 顶边 141 距参考线 143 仅 2
    const snap = computeSnap(box(0, 141), [box(500, 100)], 7, null);
    expect(snap.dy).toBe(2);
    expect(snap.guides.horizontal).toEqual([143]);
  });

  it('远离其他节点时退化为网格吸附', () => {
    const snap = computeSnap(box(1003, 496), [], 7, 8);
    expect(snap.dx).toBe(-3); // 1003 → 1000
    expect(snap.dy).toBe(0); // 496 已是 8 的倍数
    expect(snap.guides.vertical).toEqual([1000]);
  });

  it('节点对齐与网格平票时优先节点对齐', () => {
    const moving = box(197, 0); // 192 是 8 的倍数（差 -5），200 是另一台设备的左边（差 +3）
    const snap = computeSnap(moving, [box(200, 300)], 7, 8);
    expect(snap.dx).toBe(3);
    expect(snap.guides.vertical).toEqual([200]);
  });

  it('阈值之外不做任何吸附', () => {
    const snap = computeSnap(box(1003, 507), [box(900, 900)], 7, null);
    expect(snap).toEqual({ dx: 0, dy: 0, guides: { vertical: [], horizontal: [] } });
  });

  it('snapToGrid 四舍五入到最近网格', () => {
    expect(snapToGrid(3, 8)).toBe(0);
    expect(snapToGrid(5, 8)).toBe(8);
    expect(snapToGrid(-3, 8)).toBe(-0);
  });
});

describe('框选判定', () => {
  it('相交即选中（不必完全包含）', () => {
    expect(boxIntersects(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
    expect(boxIntersects(box(0, 0, 10, 10), box(20, 0, 10, 10))).toBe(false);
  });

  it('normalizeBox 支持反向拖拽', () => {
    expect(normalizeBox({ x: 100, y: 80 }, { x: 20, y: 10 })).toEqual({
      x: 20,
      y: 10,
      w: 80,
      h: 70,
    });
  });

  it('boxesBounds 求包围盒', () => {
    expect(boxesBounds([box(0, 0, 100, 50), box(200, 100, 100, 50)])).toEqual({
      x: 0,
      y: 0,
      w: 300,
      h: 150,
    });
    expect(boxesBounds([])).toBeNull();
  });
});

describe('机柜 U 位与设备高度（FR-36 / FR-39）', () => {
  const rack = { x: 100, y: 100, rack: { heightU: 24, flipped: false } };

  it('4U 恰好等于标准卡片高度；更大的 U 数让卡片变高', () => {
    expect(RACK_UNIT_H * 4 - 6).toBe(NODE_H); // U 刻度的定义：4U = 一张卡片
    expect(cardHeightForUnits(4)).toBe(NODE_H);
    expect(cardHeightForUnits(8)).toBe(8 * RACK_UNIT_H - 6);
    expect(cardHeightForUnits(8)).toBeGreaterThan(cardHeightForUnits(4));
  });

  it('rackUnitsOf 缺省为 4U，并钳制在 4–24', () => {
    expect(rackUnitsOf({})).toBe(4);
    expect(rackUnitsOf({ rackUnits: 8 })).toBe(8);
    expect(rackUnitsOf({ rackUnits: 1 })).toBe(4); // 卡片放不下更小的面板
    expect(rackUnitsOf({ rackUnits: 99 })).toBe(24);
    expect(rackUnitsOf({ rackUnits: 8.4 })).toBe(8);
  });

  it('cardHeightOf 直接由设备的 U 数决定', () => {
    expect(cardHeightOf({ rackUnits: 4 })).toBe(NODE_H);
    expect(cardHeightOf({ rackUnits: 8 })).toBe(cardHeightForUnits(8));
  });

  it('多 U 设备的卡片高度与 U 位内容区一致（不会超出柜体）', () => {
    const box = rackSlotContentBox(rack, 2, 8);
    expect(box.h).toBe(cardHeightForUnits(8));
    // 卡片必须落在机柜内部
    const rackBottom = rack.y + 32 + 12 * RACK_UNIT_H + 12;
    expect(box.y).toBeGreaterThan(rack.y);
    expect(box.y + box.h).toBeLessThanOrEqual(rackBottom);
    // 第 2U 起、占 8U 的卡片应当从第 2 格开始
    expect(box.y).toBeGreaterThan(rackSlotContentBox(rack, 1, 8).y);
  });

  it('rackMountPosition 与 U 位内容区一致，且随起始 U 与 U 数变化', () => {
    const one = rackMountPosition(rack, 1, 1);
    const two = rackMountPosition(rack, 2, 1);
    const big = rackMountPosition(rack, 1, 8);
    expect(Number.isInteger(one.x)).toBe(true);
    expect(two.y).toBeGreaterThan(one.y);

    // 多 U 卡片落在自己的 U 位内容区里（垂直居中），高度高于 1U
    const box = rackSlotContentBox(rack, 1, 8);
    expect(big.x).toBe(Math.round(box.x));
    expect(big.y).toBe(Math.round(box.y));
    expect(box.h).toBeGreaterThan(cardHeightForUnits(4));
  });

  it('机柜宽高比接近真实 19″ 机架（设备宽 ÷ 1U 高 ≈ 10.86）', () => {
    // 真实值：设备宽 482.6 mm、1U 高 44.45 mm
    expect(RACK_EQUIPMENT_W / RACK_UNIT_H).toBeCloseTo(10.86, 1);
    // 外框宽度约为设备宽的 1.24 倍（左右导轨）
    expect(RACK_W / RACK_EQUIPMENT_W).toBeCloseTo(1.24, 2);
    // 设备面板宽度 + 两侧导轨 = 机柜外宽（不多不少）
    expect(RACK_EQUIPMENT_W + 2 * (RACK_PAD_X + RACK_RAIL_W)).toBe(RACK_W);
  });

  it('上架设备的卡片宽度跟随机柜（19 英寸设备宽度），未上架用标准宽度', () => {
    expect(cardWidthOf({})).toBe(NODE_W);
    expect(cardWidthOf({ mount: { rackId: 'r', startU: 1 } })).toBe(RACK_EQUIPMENT_W);
    // U 位内容区的宽度就是设备面板宽度，位置正好落在两导轨之间
    const box = rackSlotContentBox(rack, 1, 4);
    expect(box.w).toBe(RACK_EQUIPMENT_W);
    expect(box.x).toBe(rack.x + RACK_PAD_X + RACK_RAIL_W);
  });

  it('4U 上架卡片的宽高比与真实 4U 设备一致（约 2.7–2.9）', () => {
    const aspect = RACK_EQUIPMENT_W / cardHeightForUnits(4);
    expect(aspect).toBeGreaterThan(2.6);
    expect(aspect).toBeLessThan(3.0);
  });

  it('findFreeSlot 会为多 U 设备寻找连续空位，跳过被零散占用的位置', () => {
    const occupied = [
      { startU: 1, heightU: 4 },
      { startU: 6, heightU: 4 },
    ];
    // 8U 设备要连续 8 格：U1–4 与 U6–9 都被占，只能从 U10 起
    expect(findFreeSlot(rack, occupied, 8)).toBe(10);
    // 4U 设备：U5 虽空，但 U5–8 会撞上已占的 U6–9，只能落到 U10
    expect(findFreeSlot(rack, occupied, 4)).toBe(10);
  });

  it('机柜装不下时返回 null', () => {
    const small = { x: 0, y: 0, rack: { heightU: 8, flipped: false } };
    expect(findFreeSlot(small, [], 12)).toBeNull();
    expect(findFreeSlot(small, [{ startU: 1, heightU: 8 }], 4)).toBeNull();
  });
});
