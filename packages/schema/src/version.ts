/**
 * 场景结构版本
 *
 * 单独一个模块：`index.ts` 与 `validate.ts` 都要用它，放在 index 里会造成
 * "index 导出 validate、validate 又引用 index" 的循环。
 */
export const SCHEMA_VERSION = 1 as const;
