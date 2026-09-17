/**
 * 左侧栏：页面 + 页签（FR-43 / FR-70）
 *
 * 左栏的页面是**二选一的工作区**（设备目录 / 节点树），所以用**页签**切换：
 * 每页占满整个侧栏高度，点页签切页 —— 与旧版的两页签行为一致，
 * 也与 VSCode 主侧栏"一次显示一个视图容器"一致。
 *
 * 页签同时也是**拖拽手柄**：
 *  · 在页签条内左右拖动 = 换位；
 *  · 拖到右侧栏 = 把这一页搬过去（它在那里按堆叠面板的方式呈现）；
 *  · 右侧栏的页面也能拖回来，成为这里的一个页签。
 * 于是"页面在两侧之间挪动"是双向的，且搬过去之后**内容跟着页面走**（见 cards.tsx）。
 */

import { useRef, useState, type ReactNode } from 'react';
import { cardTitle } from '../lib/panels';
import { registerSidebar, resolveSidebarDrop } from './sidebar-drop';
import { useApp } from '../state/store';

/** 拖动启动阈值：小于它的位移算"点页签"（切页） */
const DRAG_THRESHOLD_PX = 4;

export function SidebarTabs({ renderPage }: { renderPage: (cardId: string) => ReactNode }) {
  const layout = useApp((s) => s.uiLayout);
  const draggingCard = useApp((s) => s.draggingCard);
  const dropTarget = useApp((s) => s.cardDropTarget);
  const beginCardDrag = useApp((s) => s.beginCardDrag);
  const setCardDropTarget = useApp((s) => s.setCardDropTarget);
  const endCardDrag = useApp((s) => s.endCardDrag);
  const moveCard = useApp((s) => s.moveCard);
  const setActiveTab = useApp((s) => s.setActiveTab);

  const rootRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{
    cardId: string;
    pointerX: number;
    pointerY: number;
    active: boolean;
    target: { side: 'left' | 'right'; index: number } | null;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const tabs = layout.left;
  const active = tabs.includes(layout.activeLeft) ? layout.activeLeft : tabs[0];

  const onTabPointerDown = (cardId: string) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pending.current = {
      cardId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      active: false,
      target: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onTabPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pending.current;
    if (!drag) return;
    if (!drag.active) {
      const moved =
        Math.abs(event.clientY - drag.pointerY) + Math.abs(event.clientX - drag.pointerX);
      if (moved < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      setDragging(true);
      beginCardDrag(drag.cardId, 'left');
    }
    drag.target = resolveSidebarDrop(drag.cardId, event.clientX, event.clientY);
    setCardDropTarget(drag.target);
  };

  const onTabPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pending.current;
    pending.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag) return;

    if (!drag.active) {
      // 没拖动 = 点页签 → 切页（并把焦点留给页签，键盘用户不丢位置）
      setActiveTab(drag.cardId);
      return;
    }

    setDragging(false);
    const target = drag.target;
    if (!target) {
      endCardDrag();
      return;
    }
    const list = target.side === 'left' ? layout.left : layout.right;
    const without = list.filter((id) => id !== drag.cardId);
    const nextOrder = [
      ...without.slice(0, target.index),
      drag.cardId,
      ...without.slice(target.index),
    ];
    const unchanged = target.side === 'left' && nextOrder.join('|') === list.join('|');
    if (unchanged) endCardDrag();
    // 拖到右侧栏时，这一页在那里是"堆叠面板"，插入位用同一个 index
    else moveCard(drag.cardId, target.side, target.index);
  };

  const onTabPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    pending.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    endCardDrag();
  };

  /** 页签条的键盘：←/→ 切页（WAI-ARIA tabs 的惯例），Alt+←/→ 把这一页搬到另一侧 */
  const onTabKeyDown = (cardId: string) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.indexOf(cardId);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setActiveTab(cardId);
      return;
    }
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const target = event.key === 'ArrowLeft' ? 'left' : 'right';
      if (target === 'left') return;
      const rightCount = layout.right.length;
      moveCard(cardId, 'right', rightCount);
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const next = event.key === 'ArrowUp' ? at - 1 : at + 1;
      if (next < 0 || next >= tabs.length) return;
      moveCard(cardId, 'left', next);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setActiveTab(tabs[next]);
      const nextEl = rootRef.current?.querySelector<HTMLElement>(
        `[data-drop-id="${tabs[next]}"]`,
      );
      nextEl?.focus();
    }
  };

  const indicator = (index: number) =>
    dragging && dropTarget?.side === 'left' && dropTarget.index === index ? (
      <span data-drop-indicator className="my-1 w-0.5 shrink-0 rounded bg-sky-500" />
    ) : null;

  return (
    <div
      ref={(element) => {
        rootRef.current = element;
        registerSidebar('left', element);
      }}
      data-sidebar-stack="left"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div
        role="tablist"
        aria-label="左侧栏页面"
        className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-slate-800 bg-slate-900/80 px-1"
      >
        {tabs.map((cardId, index) => {
          const selected = cardId === active;
          const isDragged = draggingCard?.cardId === cardId;
          return (
            <div key={cardId} className="flex items-stretch">
              {indicator(index)}
              <div
                data-drop-item
                data-drop-id={cardId}
                data-card-id={cardId}
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                title={`${cardTitle(cardId)}｜点击切换 · 拖动换位或拖到右侧栏（Alt+←/→ 换栏）`}
                onPointerDown={onTabPointerDown(cardId)}
                onPointerMove={onTabPointerMove}
                onPointerUp={onTabPointerUp}
                onPointerCancel={onTabPointerCancel}
                onKeyDown={onTabKeyDown(cardId)}
                className={`flex cursor-grab items-center gap-1 border-b-2 px-2.5 py-2 text-[11px] font-medium transition select-none active:cursor-grabbing focus:outline-none ${
                  selected
                    ? 'border-sky-500 text-sky-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                } ${isDragged ? 'opacity-40' : ''}`}
              >
                {cardTitle(cardId)}
              </div>
            </div>
          );
        })}
        {indicator(tabs.length)}
        {tabs.length === 0 && (
          <span className="px-2 py-2 text-[10px] text-slate-600">
            这里还没有页面 —— 把右侧栏的页面标题拖过来即可
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{active ? renderPage(active) : null}</div>
    </div>
  );
}
