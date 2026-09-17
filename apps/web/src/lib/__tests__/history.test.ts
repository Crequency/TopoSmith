/** 撤销/重做栈单测（FR-31） */

import { describe, expect, it } from 'vitest';
import { History } from '../history';

describe('撤销/重做栈', () => {
  it('记录后可以撤销回到上一状态，撤销的结果是"变更前"的快照', () => {
    const history = new History<string>();
    history.record('A', { label: '改动1', now: 1000 });
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    const previous = history.undo('B');
    expect(previous).toBe('A');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it('撤销后可以重做，回到撤销前的状态', () => {
    const history = new History<string>();
    history.record('A', { label: '改动1', now: 1000 });
    const undone = history.undo('B')!;
    const redone = history.redo(undone)!;
    expect(redone).toBe('B');
    expect(history.canRedo).toBe(false);
  });

  it('多次撤销按后进先出顺序回退', () => {
    const history = new History<string>();
    history.record('A', { label: '1', now: 1000 });
    history.record('B', { label: '2', now: 2000 });
    history.record('C', { label: '3', now: 3000 });

    expect(history.undo('D')).toBe('C');
    expect(history.undo('C')).toBe('B');
    expect(history.undo('B')).toBe('A');
    expect(history.undo('A')).toBeNull();
  });

  it('撤销之后再产生新改动会清空重做栈（分支不会丢失）', () => {
    const history = new History<string>();
    history.record('A', { label: '1', now: 1000 });
    history.undo('B');
    expect(history.canRedo).toBe(true);
    history.record('X', { label: '新改动', now: 5000 });
    expect(history.canRedo).toBe(false);
  });

  it('相同 mergeKey 且落在合并窗口内只记一条（连续打字不会退化成按字符撤销）', () => {
    const history = new History<string>();
    history.record('A', { label: '改名字', mergeKey: 'name:dev-1', now: 1000 });
    history.record('B', { label: '改名字', mergeKey: 'name:dev-1', now: 1500 });
    history.record('C', { label: '改名字', mergeKey: 'name:dev-1', now: 2000 });
    expect(history.depth.past).toBe(1);
    expect(history.undo('D')).toBe('A'); // 一次撤销回到最初的 A
  });

  it('超出合并窗口或 mergeKey 不同则分别记录', () => {
    const history = new History<string>();
    history.record('A', { label: '改名字', mergeKey: 'name:dev-1', now: 1000 });
    history.record('B', { label: '改名字', mergeKey: 'name:dev-1', now: 5000 }); // 超出 1.2s
    history.record('C', { label: '改别的', mergeKey: 'vlan:dev-1', now: 5100 });
    expect(history.depth.past).toBe(3);
  });

  it('事务：整段拖动只记一条历史，中途改动不记录', () => {
    const history = new History<string>();
    history.begin('拖动前', '移动设备');
    history.record('中间1', { label: '移动设备', now: 1000 });
    history.record('中间2', { label: '移动设备', now: 1010 });
    const pushed = history.commit('拖动后');
    expect(pushed).toBe(true);
    expect(history.depth.past).toBe(1);
    expect(history.undo('拖动后')).toBe('拖动前');
  });

  it('事务没有产生实际改动（引用相同）时不入栈', () => {
    const history = new History<string>();
    history.begin('原状态', '移动设备');
    expect(history.commit('原状态')).toBe(false);
    expect(history.canUndo).toBe(false);
  });

  it('栈有上限，超出后丢弃最旧的记录', () => {
    const history = new History<string>(3);
    for (const label of ['A', 'B', 'C', 'D']) {
      history.record(label, { label, now: 1000 * Math.random() + 10000 });
    }
    expect(history.depth.past).toBe(3);
  });

  it('clear 清空全部历史', () => {
    const history = new History<string>();
    history.record('A', { label: '1', now: 1000 });
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.depth.inTransaction).toBe(false);
  });
});
