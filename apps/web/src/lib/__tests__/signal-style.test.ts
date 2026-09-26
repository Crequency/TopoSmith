/**
 * 无线动画形态的几何与设置解析（FR-86）
 *
 * 这些函数决定"九种动画长什么样"和"某台设备最终用哪一种"。它们都是纯函数，
 * 因此"涟漪在扩散""高频更密""波束在扫""统一覆盖优先于设备设置"这些结论
 * 都能被单测钉住 —— 动画靠肉眼很难发现"某一种其实没动"或"优先级搞反了"。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WIRELESS_ANIMATION,
  WIRELESS_ANIMATION_STYLES,
  WIRELESS_ANIMATION_META,
  isWirelessAnimationStyle,
  normalizeAnimationStyle,
} from '@toposmith/schema';
import {
  DEFAULT_SETTINGS,
  animationChoiceOf,
  animationSource,
  normalizeSettings,
  normalizeWirelessAnimationSetting,
  resolveAnimationStyle,
  styleFromChoice,
} from '../settings';
import {
  beamLocked,
  hexNeighbours,
  beamSweep,
  cellMover,
  emWavelengthPx,
  emWavePoints,
  hexagonPoints,
  linePulse,
  pulseLevel,
  rippleRings,
  streamDots,
} from '../../render/signal-styles';

describe('动画形态的目录', () => {
  it('九种形态：默认信号波 + 用户列的八种，且每种都有中文名、英文名与说明', () => {
    expect(WIRELESS_ANIMATION_STYLES).toHaveLength(9);
    expect(WIRELESS_ANIMATION_STYLES[0]).toBe(DEFAULT_WIRELESS_ANIMATION);
    for (const style of WIRELESS_ANIMATION_STYLES) {
      const meta = WIRELESS_ANIMATION_META[style];
      expect(meta.label.length).toBeGreaterThan(1);
      expect(meta.latin.length).toBeGreaterThan(1);
      expect(meta.scene.length).toBeGreaterThan(1);
      expect(meta.form.length).toBeGreaterThan(1);
    }
  });

  it('用户给的八种英文名都在目录里（对照表可直接核对）', () => {
    const latin = WIRELESS_ANIMATION_STYLES.map((style) => WIRELESS_ANIMATION_META[style].latin);
    for (const name of [
      'Ripple',
      'Beam Sweeping',
      'Data Stream',
      'Connection Line',
      'Cell Grid',
      'EM Wave',
      'Massive MIMO',
      'Pulse',
    ]) {
      expect(latin).toContain(name);
    }
  });

  it('非法值一律回落到默认动画', () => {
    expect(normalizeAnimationStyle('nope')).toBe(DEFAULT_WIRELESS_ANIMATION);
    expect(normalizeAnimationStyle(undefined)).toBe(DEFAULT_WIRELESS_ANIMATION);
    expect(isWirelessAnimationStyle('ripple')).toBe(true);
    expect(isWirelessAnimationStyle('waves ')).toBe(false);
  });
});

describe('两层设置的解析', () => {
  it('遵照设备：设备没设 → 默认；设备设了 → 用设备的', () => {
    const perDevice = { mode: 'per-device' } as const;
    expect(resolveAnimationStyle(perDevice, undefined)).toBe(DEFAULT_WIRELESS_ANIMATION);
    expect(resolveAnimationStyle(perDevice, 'beam')).toBe('beam');
    expect(animationSource(perDevice, undefined)).toBe('default');
    expect(animationSource(perDevice, 'beam')).toBe('device');
  });

  it('统一覆盖：压过设备的单独设置（这是"覆盖"的定义）', () => {
    const unified = { mode: 'unified', style: 'mimo' } as const;
    expect(resolveAnimationStyle(unified, undefined)).toBe('mimo');
    expect(resolveAnimationStyle(unified, 'pulse')).toBe('mimo');
    expect(animationSource(unified, 'pulse')).toBe('unified');
  });

  it('规范化：坏数据回落默认，统一模式缺 style 也回落默认形态', () => {
    expect(normalizeWirelessAnimationSetting(null)).toEqual({ mode: 'per-device' });
    expect(normalizeWirelessAnimationSetting({ mode: '统一' })).toEqual({ mode: 'per-device' });
    expect(normalizeWirelessAnimationSetting({ mode: 'unified' })).toEqual({
      mode: 'unified',
      style: DEFAULT_WIRELESS_ANIMATION,
    });
    expect(normalizeWirelessAnimationSetting({ mode: 'unified', style: 'em' })).toEqual({
      mode: 'unified',
      style: 'em',
    });
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ wirelessAnimation: { mode: 'unified', style: 'nope' } })).toEqual({
      wirelessAnimation: { mode: 'unified', style: DEFAULT_WIRELESS_ANIMATION },
    });
  });

  it('设备选择器的取值：inherit 与具体形态互转', () => {
    expect(animationChoiceOf(undefined)).toBe('inherit');
    expect(animationChoiceOf('cell')).toBe('cell');
    expect(styleFromChoice('inherit')).toBeUndefined();
    expect(styleFromChoice('cell')).toBe('cell');
  });
});

describe('信号涟漪', () => {
  it('若干圈同时存在，半径随相位增大而增大，并且透明度渐弱', () => {
    const rings = rippleRings(200, 0.3);
    expect(rings.length).toBeGreaterThanOrEqual(4);
    for (const ring of rings) {
      expect(ring.radius).toBeGreaterThan(0);
      expect(ring.alpha).toBeGreaterThanOrEqual(0);
      expect(ring.alpha).toBeLessThanOrEqual(0.75);
    }
    // 相位推进 → 每一圈的半径都增大（扩散）
    const later = rippleRings(200, 0.4);
    expect(later[0]!.radius).toBeGreaterThan(rings[0]!.radius);
    // 圈数固定（不随相位增减，避免闪烁）
    expect(later.length).toBe(rings.length);
  });

  it('半径上限由最远对端决定（不会铺满画布）', () => {
    const rings = rippleRings(50, 0.99);
    for (const ring of rings) expect(ring.radius).toBeLessThanOrEqual(50 * 1.05 + 0.001);
  });
});

describe('波束扫描', () => {
  it('在目标方向两侧来回扫，并且会经过"正对目标"（锁定）', () => {
    const target = 1.2;
    const samples = Array.from({ length: 33 }, (_, i) => beamSweep(target, i / 32));
    const offsets = samples.map((sample) => sample.offset);
    expect(Math.max(...offsets)).toBeGreaterThan(0.5); // 扫到一侧
    expect(Math.min(...offsets)).toBeLessThan(-0.5); // 扫到另一侧
    // 相位 0 / 0.5 时正对目标
    expect(beamLocked(beamSweep(target, 0).offset)).toBe(true);
    expect(beamLocked(beamSweep(target, 0.5).offset)).toBe(true);
    expect(beamLocked(beamSweep(target, 0.25).offset)).toBe(false);
    // 扫描角始终围绕目标方向
    for (const sample of samples) {
      expect(Math.abs(sample.angle - target)).toBeLessThanOrEqual(Math.PI / 5 + 1e-9);
    }
  });
});

describe('电磁波', () => {
  it('频率越高波长越短（波越密），并且有可读的上下限', () => {
    const lte = emWavelengthPx(1800);
    const wifi24 = emWavelengthPx(2437);
    const wifi5 = emWavelengthPx(5745);
    const nr = emWavelengthPx(3500);
    expect(wifi24).toBeGreaterThan(wifi5); // 2.4G 比 5G 疏
    expect(wifi5).toBeGreaterThanOrEqual(10);
    expect(lte).toBeGreaterThan(wifi24);
    expect(nr).toBeLessThan(wifi24);
    // 荒谬输入不产生荒谬结果
    expect(emWavelengthPx(0)).toBe(emWavelengthPx(2400));
    expect(emWavelengthPx(Number.NaN)).toBe(emWavelengthPx(2400));
    expect(emWavelengthPx(1e9)).toBe(10);
  });

  it('正弦波采样：首尾在中轴上，中段才有摆幅；相位推进使波形移动', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 400, y: 0 };
    const points = emWavePoints(from, to, 20, 0, 6);
    expect(points.length).toBeGreaterThan(24);
    expect(points[0]!.y).toBeCloseTo(0, 6); // 两端收窄
    expect(points[points.length - 1]!.y).toBeCloseTo(0, 6);
    const maxSwing = Math.max(...points.map((point) => Math.abs(point.y)));
    expect(maxSwing).toBeGreaterThan(2);
    expect(maxSwing).toBeLessThanOrEqual(6.001);

    const shifted = emWavePoints(from, to, 20, 0.25, 6);
    const same = points.every(
      (point, index) => Math.abs(point.y - (shifted[index]?.y ?? 0)) < 1e-6,
    );
    expect(same).toBe(false); // 相位推进 → 波形在动
  });
});

describe('数据流与连接线', () => {
  it('光点一半向前、一半向后，位置随相位移动且在两端淡出', () => {
    const before = streamDots(0.2);
    const after = streamDots(0.3);
    expect(before).toHaveLength(4);
    expect(before.filter((dot) => dot.forward)).toHaveLength(2);
    expect(before.filter((dot) => !dot.forward)).toHaveLength(2);
    // 相邻两个光点的相位相反 → 一前一后（"来回移动"）
    expect(after[0]!.t).not.toBeCloseTo(before[0]!.t, 3);
    for (const dot of before) {
      expect(dot.t).toBeGreaterThanOrEqual(0);
      expect(dot.t).toBeLessThanOrEqual(1);
      expect(dot.alpha).toBeGreaterThanOrEqual(0);
    }
  });

  it('连接线脉冲沿线来回走，位置有界、强度在端点最弱', () => {
    const positions = Array.from({ length: 21 }, (_, i) => linePulse(i / 20).at);
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...positions)).toBeLessThanOrEqual(1);
    // 中段（at=0.5）比两端（at≈0 / at=1）亮：脉冲走到端头时最弱
    const middle = linePulse(0.125);
    expect(middle.at).toBeCloseTo(0.5, 3);
    expect(middle.alpha).toBeGreaterThan(linePulse(0.001).alpha);
    // phase 0.25 → 走到终点（at = 1），phase 0 → 起点
    expect(linePulse(0.25).at).toBeCloseTo(1, 3);
    expect(linePulse(0).at).toBeCloseTo(0, 3);
    expect(middle.alpha).toBeGreaterThan(linePulse(0.25).alpha);
  });
});

describe('蜂窝网格与脉冲', () => {
  it('六边形：六个顶点、等半径、尖顶朝上', () => {
    const center = { x: 100, y: 50 };
    const hex = hexagonPoints(center, 40);
    expect(hex).toHaveLength(6);
    for (const point of hex) {
      expect(Math.hypot(point.x - center.x, point.y - center.y)).toBeCloseTo(40, 6);
    }
    // 第一个顶点在正上方（尖顶朝上）
    expect(hex[0]!.x).toBeCloseTo(center.x, 6);
    expect(hex[0]!.y).toBeCloseTo(center.y - 40, 6);
  });

  it('六个邻居单元的间距符合点顶六边形布局（横向 √3R、斜向 1.5R）', () => {
    const center = { x: 0, y: 0 };
    const radius = 100;
    const neighbours = hexNeighbours(center, radius);
    expect(neighbours).toHaveLength(6);
    const east = neighbours[0]!;
    expect(east.x).toBeCloseTo(Math.sqrt(3) * radius, 6);
    expect(east.y).toBeCloseTo(0, 6);
    const northEast = neighbours[1]!;
    expect(northEast.x).toBeCloseTo((Math.sqrt(3) * radius) / 2, 6);
    expect(northEast.y).toBeCloseTo(-1.5 * radius, 6);
    // 每个邻居与中心距离相同（正六边形网格的对称性）
    const distances = neighbours.map((point) => Math.hypot(point.x, point.y));
    expect(new Set(distances.map((d) => Math.round(d * 1000))).size).toBe(1);
  });

  it('终端在小区之间来回移动，并在两端标记"切换基站"', () => {
    const samples = Array.from({ length: 41 }, (_, i) => cellMover(i / 40));
    expect(Math.min(...samples.map((s) => s.t))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples.map((s) => s.t))).toBeLessThanOrEqual(1);
    expect(samples.some((s) => s.switching)).toBe(true);
    expect(samples.some((s) => !s.switching)).toBe(true);
  });

  it('脉冲强度在 0–1 之间起伏（有节奏地闪烁）', () => {
    const levels = Array.from({ length: 21 }, (_, i) => pulseLevel(i / 20));
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...levels)).toBeLessThanOrEqual(1);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.8);
  });
});
