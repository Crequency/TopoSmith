/**
 * 命令菜单的数据与过滤单测（FR-71）
 *
 * 面板是 UI 占位，但"列表内容与过滤"是纯逻辑，能测就该测：
 * 分组顺序稳定、过滤大小写无关、空查询给全量、没命中给空数组（而不是"还剩几条无关的"）。
 */

import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  filterCommands,
  flattenCommands,
  unwiredCount,
  type MenuCommand,
} from '../command-menu';

describe('命令菜单数据', () => {
  it('命令 id 唯一，标签与分组都不为空', () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of COMMANDS) {
      expect(command.label.length).toBeGreaterThan(1);
      expect(command.group.length).toBeGreaterThan(0);
    }
  });

  it('这一版全部是未接入（面板只做 UI）', () => {
    expect(unwiredCount()).toBe(COMMANDS.length);
  });
});

describe('命令过滤与分组', () => {
  it('空查询返回全部，且分组按固定顺序排列', () => {
    const sections = filterCommands('');
    expect(flattenCommands(sections)).toHaveLength(COMMANDS.length);
    expect(sections.map((section) => section.group)).toEqual(['视图', '场景', '编辑', '诊断', '布局']);
  });

  it('大小写无关的子串匹配：中文标签、英文 id、分组名都能命中', () => {
    expect(flattenCommands(filterCommands('撤销')).map((c) => c.id)).toEqual(['edit.undo']);
    expect(flattenCommands(filterCommands('DIAG')).map((c) => c.id)).toEqual([
      'diag.ping',
      'diag.trace',
      'diag.bandwidth',
      'diag.dns',
      'diag.clear-cache',
    ]);
    expect(flattenCommands(filterCommands('视图')).length).toBeGreaterThanOrEqual(5);
  });

  it('没有命中时返回空（而不是退回全量）', () => {
    expect(filterCommands('这个词不存在')).toEqual([]);
    expect(flattenCommands(filterCommands('这个词不存在'))).toEqual([]);
  });

  it('命中项所在分组会被保留，空分组被丢掉', () => {
    const sections = filterCommands('场景');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.group).toBe('场景');
  });

  it('自定义命令集也能用（将来接入真命令时替换数据源即可）', () => {
    const custom: MenuCommand[] = [
      { id: 'a', label: '适应视图', group: '视图', wired: true },
      { id: 'b', label: '导出场景', group: '场景', wired: true },
    ];
    expect(flattenCommands(filterCommands('', custom)).map((c) => c.id)).toEqual(['a', 'b']);
    expect(unwiredCount(custom)).toBe(0);
  });
});
