/** 连线摆动物理单测（FR-50） */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWAY_TUNING,
  createSway,
  isSwaySettled,
  stepSway,
  swayScaleForSpan,
  type CableSway,
} from '../cable-physics';

/** 以固定步长跑 n 帧，返回每帧结束后的偏移序列 */
function run(
  sway: CableSway,
  frames: number,
  dt: number,
  velocity: (frame: number) => { x: number; y: number },
  scale = 1,
) {
  const history: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    stepSway(sway, velocity(i), dt, scale);
    history.push(sway.x);
  }
  return history;
}

describe('连线摆动（平面物理）', () => {
  it('静止时不产生任何偏移（不能自己抖起来）', () => {
    const sway = createSway();
    const history = run(sway, 60, 1 / 60, () => ({ x: 0, y: 0 }));
    expect(history.every((x) => x === 0)).toBe(true);
    expect(isSwaySettled(sway)).toBe(true);
  });

  it('端点向右匀速移动 → 线身向左落后（方向相反）', () => {
    const sway = createSway();
    run(sway, 40, 1 / 60, () => ({ x: 300, y: 0 }));
    expect(sway.x).toBeLessThan(-1);
    // 目标值 = -v * lag = -22.5，弹簧未完全到位但方向明确
    expect(sway.x).toBeGreaterThan(-DEFAULT_SWAY_TUNING.maxOffset);
  });

  it('偏移被钳制在上限附近，匀速拖动不会越甩越大', () => {
    const sway = createSway();
    const history = run(sway, 600, 1 / 60, () => ({ x: 100000, y: 0 }));
    const maxAbs = Math.max(...history.map((x) => Math.abs(x)));
    // 目标本身被钳制在 maxOffset*lag 的量级内，加上一点超调
    expect(maxAbs).toBeLessThan(DEFAULT_SWAY_TUNING.maxOffset * 1.6);
  });

  it('松手后回摆并最终停下：至少换向一次，且末段静止', () => {
    const sway = createSway();
    run(sway, 30, 1 / 60, () => ({ x: 400, y: 0 }));
    // 松手：速度归零，只看回程
    const back = run(sway, 240, 1 / 60, () => ({ x: 0, y: 0 }));
    const signs = new Set(back.map((x) => Math.sign(x)).filter((s) => s !== 0));
    expect(signs.size).toBeGreaterThanOrEqual(2); // 换过向 = 真的"晃"了
    expect(Math.abs(back[back.length - 1] as number)).toBeLessThan(0.4);
    expect(isSwaySettled(sway)).toBe(true);
  });

  it('帧率无关：60fps 与 120fps 跑同样的时长，结果接近', () => {
    const a = createSway();
    const b = createSway();
    run(a, 60, 1 / 60, () => ({ x: 250, y: -120 }));
    run(b, 120, 1 / 120, () => ({ x: 250, y: -120 }));
    expect(Math.abs(a.x - b.x)).toBeLessThan(1.5);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1.5);
  });

  it('dt 异常（切标签页回来）不会让数值炸开', () => {
    const sway = createSway();
    stepSway(sway, { x: 5000, y: 5000 }, 3.7, 1);
    expect(Number.isFinite(sway.x)).toBe(true);
    expect(Number.isFinite(sway.vx)).toBe(true);
    expect(Math.abs(sway.x)).toBeLessThan(DEFAULT_SWAY_TUNING.maxOffset * 2);
  });

  it('幅度按线长缩放：短连线（同排两台设备）甩得少', () => {
    expect(swayScaleForSpan(40)).toBe(0.25);
    expect(swayScaleForSpan(160)).toBe(1);
    expect(swayScaleForSpan(900)).toBe(1);
    const short = createSway();
    const long = createSway();
    run(short, 40, 1 / 60, () => ({ x: 300, y: 0 }), swayScaleForSpan(40));
    run(long, 40, 1 / 60, () => ({ x: 300, y: 0 }), swayScaleForSpan(300));
    expect(Math.abs(short.x)).toBeLessThan(Math.abs(long.x));
  });
});

describe('摆动：极端输入', () => {
  it('超快甩动（一帧内走完一大段）也会甩起来，且幅度有界', () => {
    const sway = createSway();
    // 一帧内位移 900 世界单位、dt 被钳到 0.05 → 原始速度 18000，远超输入上限
    stepSway(sway, { x: 18000, y: 0 }, 0.05, 1);
    for (let i = 0; i < 12; i += 1) stepSway(sway, { x: 0, y: 0 }, 1 / 60, 1);
    expect(Math.abs(sway.x)).toBeGreaterThan(1);
    expect(Math.abs(sway.x)).toBeLessThan(DEFAULT_SWAY_TUNING.maxOffset * 2);
  });

  it('非数字速度被当作 0，不污染状态', () => {
    const sway = createSway();
    stepSway(sway, { x: Number.NaN, y: Number.POSITIVE_INFINITY }, 1 / 60, 1);
    expect(Number.isFinite(sway.x)).toBe(true);
    expect(Number.isFinite(sway.vx)).toBe(true);
    expect(sway.x).toBe(0);
  });
});
