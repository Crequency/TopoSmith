/**
 * 撤销/重做栈（FR-31）
 *
 * 单独抽成纯模块：历史逻辑（合并窗口、事务、栈上限）是纯粹的状态机，
 * 放在 zustand store 里既难以单测，也会让 store 膨胀。
 *
 * 两个关键机制：
 *  1. **合并窗口**：连续的小改动（敲名字、连续微调）在 1.2 秒内合并成一条历史，
 *     否则"撤销"会退化成一次退一个字符。
 *  2. **事务（begin/commit）**：拖动设备会在每一帧产生新状态，必须整段算作一条历史。
 */

export interface HistoryEntry<T> {
  snapshot: T;
  label: string;
}

export interface RecordOptions {
  label: string;
  /** 相同 mergeKey 且在合并窗口内的连续改动只记一条 */
  mergeKey?: string;
  /** 便于测试注入时间 */
  now?: number;
}

export class History<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private pending: HistoryEntry<T> | null = null;
  private lastMergeKey: string | null = null;
  private lastMergeAt = 0;

  constructor(
    private readonly limit = 60,
    private readonly mergeWindowMs = 1200,
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.past[this.past.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.future[0]?.label;
  }

  get depth(): { past: number; future: number; inTransaction: boolean } {
    return { past: this.past.length, future: this.future.length, inTransaction: this.pending !== null };
  }

  /** 记录一次变更前的快照 */
  record(before: T, options: RecordOptions): void {
    // 事务进行中：整段由 commit 记录，中途一律不记
    if (this.pending) return;

    const now = options.now ?? Date.now();
    const merge =
      options.mergeKey !== undefined &&
      options.mergeKey === this.lastMergeKey &&
      now - this.lastMergeAt <= this.mergeWindowMs;

    if (!merge) {
      this.past.push({ snapshot: before, label: options.label });
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
    }

    this.lastMergeKey = options.mergeKey ?? null;
    this.lastMergeAt = now;
  }

  /** 开始一段事务（例如一次拖动）：记录起点快照 */
  begin(snapshot: T, label: string): void {
    if (this.pending) return;
    this.pending = { snapshot, label };
  }

  /**
   * 结束事务。
   * @param current 事务结束时的状态；与起点**引用相同**说明没有实际改动，直接丢弃
   */
  commit(current: T): boolean {
    const pending = this.pending;
    this.pending = null;
    this.resetMerge();
    if (!pending || pending.snapshot === current) return false;

    this.past.push(pending);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return true;
  }

  /** 丢弃事务（未产生改动） */
  abort(): void {
    this.pending = null;
    this.resetMerge();
  }

  undo(current: T): T | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.unshift({ snapshot: current, label: entry.label });
    if (this.future.length > this.limit) this.future.pop();
    this.resetMerge();
    return entry.snapshot;
  }

  redo(current: T): T | null {
    const entry = this.future.shift();
    if (!entry) return null;
    this.past.push({ snapshot: current, label: entry.label });
    if (this.past.length > this.limit) this.past.shift();
    this.resetMerge();
    return entry.snapshot;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.pending = null;
    this.resetMerge();
  }

  private resetMerge(): void {
    this.lastMergeKey = null;
    this.lastMergeAt = 0;
  }
}
