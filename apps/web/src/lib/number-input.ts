/**
 * 数字输入的提交语义（FR-42）
 *
 * 问题：受控数字输入框如果在**每次按键**就钳制取值，多位数输入会被打断 ——
 * 想输 `42` 时，先输入的 `4` 被抬到下限 `8`，用户接着输 `2`，输入框里就成了 `82`，
 * 再被抬到上限 `48`，最终得到 48（用户实测反馈）。
 *
 * 解决：输入期间只保存"草稿文本"（不钳制、不解析），在**失焦或回车**时才提交：
 * 非法输入还原旧值，合法输入按 min/max 钳制。
 */

export interface NumberCommitOptions {
  min?: number;
  max?: number;
}

/**
 * 把草稿文本提交为数值。
 *
 * @returns 应当写入的值；输入非法（空串、非数字）时返回 null，表示"保持原值不变"
 */
export function commitNumberDraft(
  draft: string,
  options: NumberCommitOptions = {},
): number | null {
  const text = draft.trim();
  if (text === '') return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;

  let value = parsed;
  if (options.min !== undefined) value = Math.max(options.min, value);
  if (options.max !== undefined) value = Math.min(options.max, value);
  return value;
}

/** 输入期间是否允许继续输入（只校验"字符是否可能构成数字"，不做范围钳制） */
export function isDraftAcceptable(draft: string): boolean {
  return /^-?\d*\.?\d*$/.test(draft);
}
