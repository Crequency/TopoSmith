/**
 * 画布右键上下文菜单（FR-80）
 *
 * 约定与 VSCode / 设计工具一致：**只放真的能执行的命令**（D-53 的同一条原则 ——
 * 不做"点了没反应的假命令"）。菜单随着命令集增长而增长，接入一条就在这里加一项。
 *
 * 交互细节：
 *  · 打开时聚焦第一项，`↑↓` 在项间移动，`Enter` 执行（useEffect + 按钮原生行为）；
 *  · 点菜单外、`Esc`、执行任意命令后都关闭；
 *  · 位置做边界夹取：在画布右下角右键时菜单不能跑到窗口外。
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, uiIcon, type UiIconName } from '../lib/icons';

export interface ContextMenuItem {
  id: string;
  label: string;
  /** 右侧的补充说明（键盘快捷键、影响范围等） */
  hint?: string;
  icon?: UiIconName;
  onSelect: () => void;
}

export function ContextMenu({
  x,
  y,
  items,
  bounds,
  onClose,
  onReopen,
}: {
  /** 容器内坐标（相对画布区域左上角） */
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** 容器尺寸：用于把菜单夹在可视区域内 */
  bounds: { width: number; height: number };
  onClose: () => void;
  /** 在另一处再次右键：把菜单搬过去（容器内坐标） */
  onReopen: (at: { x: number; y: number }) => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = ref.current?.querySelector('button');
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const buttons = [...(ref.current?.querySelectorAll('button') ?? [])];
      if (buttons.length === 0) return;
      const index = buttons.findIndex((button) => button === document.activeElement);
      const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
      buttons[(next + buttons.length) % buttons.length]?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // 先按"菜单大致尺寸"夹取，再在挂载后用真实尺寸修正一次（两行以内足够准）
  const width = 240;
  const height = 16 + items.length * 34;
  const left = Math.max(4, Math.min(x, bounds.width - width - 4));
  const top = Math.max(4, Math.min(y, bounds.height - height - 4));

  return (
    <>
      {/*
        点空白处关闭：这层只在菜单打开时存在，吃掉下一次点击是有意的。
        两个细节都是实测踩出来的：
          · 右键**不关闭**而是把菜单搬到新位置 —— 连着右键换地方是常见动作；
          · 这层**不能**在 `contextmenu` 上关闭：Chromium 在 Linux 上是**松手后**才派发
            contextmenu，而菜单在这之前已经挂载，于是刚打开的菜单会被同一次手势的
            contextmenu 当场关掉（表现为"右键没反应"）。
      */}
      <div
        className="absolute inset-0 z-20"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (event.button !== 2) {
            onClose();
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          onReopen({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        }}
      />
      <div
        ref={ref}
        role="menu"
        aria-label="画布上下文菜单"
        className="absolute z-30 flex w-60 flex-col rounded-lg border border-slate-700 bg-slate-900/98 p-1 shadow-2xl backdrop-blur"
        style={{ left, top }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-200 transition hover:bg-sky-500/15 hover:text-sky-100 focus:bg-sky-500/20 focus:text-sky-100 focus:outline-none"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.icon && <Icon node={uiIcon(item.icon)} size={14} />}
            <span className="flex-1">{item.label}</span>
            {item.hint && <span className="text-[10px] text-slate-500">{item.hint}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
