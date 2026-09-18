/**
 * 信号波几何单测
 *
 * 用户对形态的要求是三条：**以卡片中心为原点**、**沿直线**、**若干条平行的弧线**。
 * 这三条都能用纯函数钉住，就不必靠肉眼看截图 —— 弧线的"平行"尤其容易在改参数时
 * 悄悄退化成一堆散弧。
 */

import { describe, expect, it } from 'vitest';
import { instantiate } from '@toposmith/catalog';
import { SCHEMA_VERSION, deviceCenter, type Cable, type Device, type Scenario } from '@toposmith/schema';
import { buildWorld } from '@toposmith/anvil';
import { waveFrontRadius, waveFrontRatios, waveFronts } from '../signals';

const from = { x: 0, y: 0 };
const to = { x: 400, y: 0 };

describe('波前位置', () => {
  it('数量随距离变化，且限制在 3–8 条之间', () => {
    // 密集度口径：每 70 px 一道波，最后夹到 3–8 条
    expect(waveFrontRatios(70 * 1, 0)).toHaveLength(3); // round(1) → 下限 3
    expect(waveFrontRatios(70 * 5, 0)).toHaveLength(5);
    expect(waveFrontRatios(70 * 20, 0)).toHaveLength(8); // 上限 8
  });

  it('相位推进时每条波前都向前走，且回绕后位置仍在 [0,1)', () => {
    const before = waveFrontRatios(360, 0);
    const after = waveFrontRatios(360, 0.01);
    expect(after[0]).toBeGreaterThan(before[0]!);
    const wrapped = waveFrontRatios(360, 0.999);
    expect(wrapped.every((t) => t >= 0 && t < 1)).toBe(true);
  });
});

describe('弧线形态', () => {
  it('所有弧线**半径相同**（平行），且弧顶落在 from→to 的直线上', () => {
    const radius = waveFrontRadius(1);
    const fronts = waveFronts(from, to, 0.25, radius);
    expect(fronts.length).toBeGreaterThanOrEqual(3);
    expect(new Set(fronts.map((front) => front.radius)).size).toBe(1);

    // 弧顶 = 弧心 + 半径 × 指向接收端的方向；它必须落在直线上
    for (const front of fronts) {
      const apexX = front.cx + front.radius * Math.cos(front.startAngle + (front.endAngle - front.startAngle) / 2);
      const apexY = front.cy + front.radius * Math.sin(front.startAngle + (front.endAngle - front.startAngle) / 2);
      expect(apexY).toBeCloseTo(0, 6); // 直线 y = 0
      expect(apexX).toBeGreaterThanOrEqual(-0.001);
      expect(apexX).toBeLessThanOrEqual(to.x + 0.001);
    }
  });

  it('弧线朝接收端鼓起：弧心在弧顶的来向一侧', () => {
    const radius = 20;
    const fronts = waveFronts(from, to, 0.5, radius);
    for (const front of fronts) {
      // 方向是 +X → 弧心必须在弧顶左边一个半径处
      const apexX = front.cx + radius;
      expect(apexX - front.cx).toBeCloseTo(radius, 6);
    }
  });

  it('竖直方向也成立（方向不依赖水平）', () => {
    const down = { x: 0, y: 300 };
    const fronts = waveFronts(from, down, 0.3, 18);
    for (const front of fronts) {
      const apexY = front.cy + front.radius;
      expect(apexY).toBeGreaterThanOrEqual(-0.001);
      expect(apexY).toBeLessThanOrEqual(down.y + 0.001);
      expect(front.cx).toBeCloseTo(0, 6);
    }
  });

  it('半径随缩放变化但有上下限（缩到 13% 时不能细到看不见）', () => {
    expect(waveFrontRadius(1)).toBe(26);
    expect(waveFrontRadius(0.25)).toBeCloseTo(13, 1);
    expect(waveFrontRadius(0.01)).toBe(9);
    expect(waveFrontRadius(0)).toBe(9);
    expect(waveFrontRadius(4)).toBe(26);
  });

  it('起止角关于传播方向对称（张开约 ±36°）', () => {
    const [front] = waveFronts(from, to, 0.5, 20);
    const mid = (front!.startAngle + front!.endAngle) / 2;
    expect(mid).toBeCloseTo(0, 6);
    expect(front!.endAngle - front!.startAngle).toBeCloseTo((2 * Math.PI) / 5, 6);
  });
});

describe('发射端与接收端', () => {
  it('几何以**提供方卡片中心**为原点、以对端卡片中心为终点', async () => {
    const { signalGeometry } = await import('../signals');
    const ap = instantiate('ap', 'dev-ap', 'AP', 0, 0);
    const laptop = instantiate('pc-laptop', 'dev-lap', '笔记本', 400, 0);
    const link: Cable = {
      id: 'cbl-1',
      type: 'wireless',
      lengthM: 0,
      a: { deviceId: 'dev-ap', portId: 'port-wlan' },
      b: { deviceId: 'dev-lap', portId: 'port-wlan' },
    };
    const scenario: Scenario = {
      schemaVersion: SCHEMA_VERSION,
      id: 'signal-fixture',
      name: 'signal fixture',
      devices: [ap, laptop] as Device[],
      cables: [link],
      updatedAt: '2026-09-18T00:00:00.000Z',
    };
    const world = buildWorld(scenario);
    const camera = { x: 0, y: 0, k: 1 };
    const derived = world.links[0]!;
    const geometry = signalGeometry(world, camera, derived, 0.4)!;

    expect(geometry.providerDeviceId).toBe('dev-ap');
    expect(geometry.peerDeviceId).toBe('dev-lap');
    // k=1、相机在原点 → 屏幕坐标 == 世界坐标；两端都必须正好是卡片中心
    expect(geometry.from).toEqual(deviceCenter(ap));
    expect(geometry.to).toEqual(deviceCenter(laptop));
    expect(geometry.fronts.length).toBeGreaterThanOrEqual(3);
  });
});
