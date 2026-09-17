/** 翻转按钮的提示文案（FR-52）：卡片上不再写"正面/背面"，这一句是唯一的文字出口 */

import { describe, expect, it } from 'vitest';
import { flipTooltipText } from '../draw';

describe('翻转按钮提示', () => {
  it('正面时提示里出现"正面"，并说明点击会翻到背面', () => {
    const text = flipTooltipText(false);
    expect(text).toContain('正面');
    expect(text).toContain('背面');
    expect(text.indexOf('正面')).toBeLessThan(text.indexOf('背面'));
  });

  it('背面时提示里先说"背面"，再说点击看正面', () => {
    const text = flipTooltipText(true);
    expect(text).toContain('背面');
    expect(text).toContain('正面');
    expect(text.indexOf('背面')).toBeLessThan(text.indexOf('正面'));
  });
});
