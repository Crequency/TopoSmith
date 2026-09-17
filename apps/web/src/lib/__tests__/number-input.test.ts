/** 数字输入提交语义单测（FR-42） */

import { describe, expect, it } from 'vitest';
import { commitNumberDraft, isDraftAcceptable } from '../number-input';

describe('数字输入提交', () => {
  const range = { min: 8, max: 48 };

  it('范围内的值原样提交 —— 输入 42 必须得到 42', () => {
    expect(commitNumberDraft('42', range)).toBe(42);
    expect(commitNumberDraft('4', range)).toBe(8); // 单独输 4 会按下限钳制（提交时）
    expect(commitNumberDraft('48', range)).toBe(48);
  });

  it('超出范围的输入在提交时钳制到边界', () => {
    expect(commitNumberDraft('82', range)).toBe(48);
    expect(commitNumberDraft('1', range)).toBe(8);
  });

  it('非法输入返回 null（调用方保持原值，不把输入框清空）', () => {
    expect(commitNumberDraft('', range)).toBeNull();
    expect(commitNumberDraft('   ', range)).toBeNull();
    expect(commitNumberDraft('abc', range)).toBeNull();
    expect(commitNumberDraft('-', range)).toBeNull();
  });

  it('小数与负数按范围处理', () => {
    expect(commitNumberDraft('12.6')).toBe(12.6);
    expect(commitNumberDraft('-5')).toBe(-5);
    expect(commitNumberDraft('-5', { min: 0 })).toBe(0);
  });

  it('输入期间的合法性判断只关心"是否可能构成数字"', () => {
    expect(isDraftAcceptable('4')).toBe(true);
    expect(isDraftAcceptable('42')).toBe(true);
    expect(isDraftAcceptable('4.')).toBe(true);
    expect(isDraftAcceptable('')).toBe(true);
    expect(isDraftAcceptable('4a')).toBe(false);
  });
});
