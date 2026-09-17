/** 速率配色单测：锚点、单调性与可辨识度（FR-34） */

import { describe, expect, it } from 'vitest';
import { legendLabel, speedColor, speedColorOf } from '../speed-color';

describe('速率配色', () => {
  it('锚点：1 Gbps 是红（色相 0），10 Gbps 是绿（色相 145）', () => {
    expect(speedColorOf(1000).hue).toBe(0);
    expect(speedColorOf(10000).hue).toBe(145);
  });

  it('色相随速率单调不减（带宽越高越绿）', () => {
    const speeds = [100, 1000, 2500, 5000, 10000, 25000, 100000];
    const hues = speeds.map((s) => speedColorOf(s).hue);
    for (let i = 1; i < hues.length; i += 1) {
      expect(hues[i]!).toBeGreaterThanOrEqual(hues[i - 1]!);
    }
    // 区间内必须是"均匀分配"而不是一刀切
    expect(speedColorOf(2500).hue).toBeCloseTo(57.7, 0);
    expect(speedColorOf(5000).hue).toBeCloseTo(101.4, 0);
  });

  it('低于 1G 与高于 10G 用亮度区分，避免挤在同一个红色/绿色上', () => {
    const slow = speedColorOf(100);
    const base = speedColorOf(1000);
    expect(slow.hue).toBe(base.hue); // 都是红
    expect(slow.lightness).toBeLessThan(base.lightness); // 但更暗

    const tenG = speedColorOf(10000);
    const hundredG = speedColorOf(100000);
    expect(hundredG.hue).toBe(tenG.hue); // 都是绿
    expect(hundredG.lightness).toBeGreaterThan(tenG.lightness); // 但更亮
  });

  it('输出可直接用于 canvas 的 hsl 字符串', () => {
    expect(speedColor(1000)).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
  });

  it('图例刻度标签', () => {
    expect(legendLabel(100)).toBe('100M');
    expect(legendLabel(1000)).toBe('1G');
    expect(legendLabel(2500)).toBe('2.5G');
    expect(legendLabel(100000)).toBe('100G');
  });
});
