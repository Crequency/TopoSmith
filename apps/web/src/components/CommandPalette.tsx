/**
 * 命令菜单（FR-71）
 *
 * `Ctrl/Cmd + Shift + P` 打开 —— 与 VSCode 同一个快捷键（mac 上是 ⌘⇧P）。
 * 这一版**只做 UI**：面板、搜索框、分组列表、键盘导航、占位提示都到位，
 * 但列表里的命令还没接入实现，界面上也直说"未接入"（见 lib/command-menu.ts 的说明）。
 *
 * 交互按 VSCode 的习惯来，几条容易漏的：
 *  · 打开即聚焦输入框，Esc 关闭并把焦点还给打开它的地方；
 *  · ↑/↓ 在**扁平后的列表**上移动高亮（跨分组连续，不是分组内循环）；
 *  · 高亮项滚进视野（键盘用户看不到高亮等于没有高亮）；
 *  · 再按一次 ⌘⇧P 关闭（切换语义），点遮罩也关。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterCommands,
  flattenCommands,
  unwiredCount,
  type MenuCommand,
} from '../lib/command-menu';
import { Icon, uiIcon } from '../lib/icons';
import { useApp } from '../state/store';

/** 与 ShortcutDialog 同一套平台判断：mac 上显示 ⌘ */
const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-slate-600 border-b-2 border-b-slate-500 bg-slate-800 px-1 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
      {children}
    </kbd>
  );
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const close = useApp((s) => s.closePalette);
  const showToast = useApp((s) => s.showToast);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => filterCommands(query), [query]);
  const flat = useMemo(() => flattenCommands(sections), [sections]);

  // 每次打开都是"干净的一次调用"：清空查询、高亮第一项、聚焦输入框
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 查询变了：高亮回到第一项（否则会停在一个不存在的位置上）
  useEffect(() => {
    setActive(0);
  }, [query]);

  // 高亮项滚进视野
  useEffect(() => {
    if (!open) return;
    const element = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    element?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  const activate = (command: MenuCommand | undefined) => {
    if (!command) return;
    showToast(
      command.wired
        ? `执行「${command.label}」`
        : `「${command.label}」尚未接入：当前版本只提供命令面板的界面`,
      'info',
    );
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (flat.length > 0) setActive((index) => (index + 1) % flat.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length > 0) setActive((index) => (index - 1 + flat.length) % flat.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(flat[active]);
    }
  };

  const pending = unwiredCount();
  let cursor = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 px-4 pt-[10vh] backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="命令菜单"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-3 py-2.5">
          <Icon node={uiIcon('search')} size={14} className="shrink-0 text-slate-500" />
          <span aria-hidden className="shrink-0 font-mono text-xs text-sky-400">
            &gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            aria-label="命令搜索"
            placeholder="输入命令名称…"
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500"
          />
          <span className="flex shrink-0 items-center gap-1" title="再按一次可关闭">
            <Kbd>{mod}</Kbd>
            <Kbd>⇧</Kbd>
            <Kbd>P</Kbd>
          </span>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-slate-500">
              没有匹配「{query.trim()}」的命令
            </p>
          ) : (
            sections.map((section) => (
              <section key={section.group} className="flex flex-col py-0.5">
                <h3 className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {section.group}
                </h3>
                {section.commands.map((command) => {
                  cursor += 1;
                  const index = cursor;
                  const isActive = index === active;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      data-command-id={command.id}
                      data-active={isActive}
                      onMouseMove={() => setActive(index)}
                      onClick={() => activate(command)}
                      className={`flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition ${
                        isActive ? 'bg-sky-500/20 text-slate-100' : 'text-slate-300 hover:bg-slate-800/60'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{command.label}</span>
                      {command.wired ? null : (
                        <span className="shrink-0 rounded bg-slate-800 px-1 py-0.5 text-[9px] text-slate-500">
                          未接入
                        </span>
                      )}
                      {command.shortcut && (
                        <span className="flex shrink-0 items-center gap-0.5">
                          {command.shortcut.map((key) => (
                            <Kbd key={key}>{key === 'mod' ? mod : key}</Kbd>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-800 px-3 py-1.5 text-[10px] text-slate-500">
          <span>
            {pending === 0
              ? '↑↓ 选择 · Enter 执行 · Esc 关闭'
              : `当前版本只提供面板界面：${pending} 条命令尚未接入，点按不会执行任何操作`}
          </span>
          <span className="shrink-0">↑↓ 选择 · Enter 执行 · Esc 关闭</span>
        </footer>
      </div>
    </div>
  );
}
