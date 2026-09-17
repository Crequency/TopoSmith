/**
 * 右侧栏的**堆叠面板**（FR-60 / FR-70）
 *
 * 右栏与左栏的排布方式**故意不同**：
 *  · 左栏是"二选一的工作区"（设备目录 / 节点树），用页签切换；
 *  · 右栏的检查器与诊断要**同时可见**，所以上下堆叠、按**权重**分配高度、
 *    相邻面板之间可以拖 —— 这正是 FR-60「检查器/诊断高度比例可调」的推广形式
 *    （N=2 时就是一条分割线）。
 *
 * 面板标题栏既是拖拽手柄（本栏换位 / 拖到左栏变成页签），也是折叠开关：
 * 把不常看的那块折起来，另一个立刻拿到全部高度。
 *
 * 与左栏共用 `sidebar-drop.ts` 的落点判定：拖拽逻辑只该有一份实现。
 */

import { Fragment, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_CARDS,
  DEFAULT_RIGHT_WEIGHTS,
  MIN_PANE_PX,
  weightsFromBoundary,
  type SidebarSide,
} from '../lib/panels';
import { Icon, uiIcon } from '../lib/icons';
import { registerSidebar, resolveSidebarDrop } from './sidebar-drop';
import { useApp } from '../state/store';

/** 拖动启动阈值：小于它的位移算"点击标题栏"（折叠 / 展开） */
const DRAG_THRESHOLD_PX = 4;
/** 键盘微调分隔条时的步长 */
const KEY_STEP_PX = 16;
const KEY_STEP_FAST_PX = 48;

/**
 * 卡片标题上的键盘意图（Alt 组合键）：
 *  · `reorder` —— 在当前侧栏内上移 / 下移；
 *  · `side`    —— 换到指定侧栏（已经在那一侧时是空操作）。
 */
type KeyboardMoveIntent =
  | { kind: 'reorder'; direction: 'up' | 'down' }
  | { kind: 'side'; side: SidebarSide };

const CARD_LABEL: Record<string, string> = Object.fromEntries(
  DEFAULT_CARDS.map((card) => [card.id, card.title]),
);

export interface SidebarStackProps {
  side: SidebarSide;
  renderCard: (cardId: string) => ReactNode;
  /** 标题栏右侧的小字说明（缺省不显示） */
  cardHint?: (cardId: string) => string | undefined;
  /** 标题栏里的操作按钮（例如诊断卡的"清空 DNS 缓存"） */
  cardActions?: (cardId: string) => ReactNode;
}

export function SidebarStack({ side, renderCard, cardHint, cardActions }: SidebarStackProps) {
  const layout = useApp((s) => s.uiLayout);
  const draggingCard = useApp((s) => s.draggingCard);
  const dropTarget = useApp((s) => s.cardDropTarget);
  const beginCardDrag = useApp((s) => s.beginCardDrag);
  const setCardDropTarget = useApp((s) => s.setCardDropTarget);
  const endCardDrag = useApp((s) => s.endCardDrag);
  const moveCard = useApp((s) => s.moveCard);
  const toggleCardCollapsed = useApp((s) => s.toggleCardCollapsed);
  const setCardWeights = useApp((s) => s.setCardWeights);

  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * 拖拽的现场状态放 ref：pointerup 那一刻要读到**最新**的落点，
   * 而事件闭包里的 state 可能是上一帧的。
   */
  const pending = useRef<{
    cardId: string;
    pointerX: number;
    pointerY: number;
    active: boolean;
    target: { side: SidebarSide; index: number } | null;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const ids = layout.right;
  const expandedIds = ids.filter((id) => !layout.collapsed[id]);

  const onHeaderPointerDown = (cardId: string) => (event: React.PointerEvent<HTMLDivElement>) => {
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

  const onHeaderPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pending.current;
    if (!drag) return;
    if (!drag.active) {
      const moved =
        Math.abs(event.clientY - drag.pointerY) + Math.abs(event.clientX - drag.pointerX);
      if (moved < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      setDragging(true);
      beginCardDrag(drag.cardId, side);
    }
    drag.target = resolveSidebarDrop(drag.cardId, event.clientX, event.clientY);
    setCardDropTarget(drag.target);
  };

  const onHeaderPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pending.current;
    pending.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag) return;

    // 没拖动 = 点击标题栏 → 折叠 / 展开
    if (!drag.active) {
      toggleCardCollapsed(drag.cardId);
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
    // 松手后顺序没变（含"原地放下"）就不写布局：不留无意义的历史与落盘噪音
    const unchanged = target.side === side && nextOrder.join('|') === list.join('|');
    if (unchanged) endCardDrag();
    else moveCard(drag.cardId, target.side, target.index);
  };

  const onHeaderPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    pending.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    endCardDrag();
  };

  const indicator = (index: number) =>
    dragging && dropTarget?.side === side && dropTarget.index === index ? (
      <div data-drop-indicator className="h-0.5 shrink-0 rounded bg-sky-500" />
    ) : null;

  return (
    <div
      ref={(element) => {
        rootRef.current = element;
        registerSidebar(side, element);
      }}
      data-card-stack={side}
      data-stack-mode="weighted"
      className="flex min-h-0 flex-1 flex-col"
    >
      {ids.map((cardId, index) => {
        const collapsed = Boolean(layout.collapsed[cardId]);
        const isDragged = draggingCard?.cardId === cardId;
        const weight = layout.weights[cardId] ?? 1;
        const nextExpanded = expandedIds[expandedIds.indexOf(cardId) + 1];
        const showSeparator = !collapsed && nextExpanded !== undefined;

        return (
          <Fragment key={cardId}>
            {indicator(index)}
            <div
              style={!collapsed ? { flexGrow: weight, flexBasis: 0 } : undefined}
              className={!collapsed ? 'flex min-h-0 flex-col' : 'flex shrink-0 flex-col'}
            >
              <CardChrome
                cardId={cardId}
                collapsed={collapsed}
                dragged={isDragged}
                hint={cardHint?.(cardId)}
                actions={cardActions?.(cardId)}
                onPointerDown={onHeaderPointerDown(cardId)}
                onPointerMove={onHeaderPointerMove}
                onPointerUp={onHeaderPointerUp}
                onPointerCancel={onHeaderPointerCancel}
                onToggle={() => toggleCardCollapsed(cardId)}
                onKeyboardMove={(intent) => {
                  if (intent.kind === 'side') {
                    // 已经在那一侧就什么都不做（否则 Alt+← 会变成"本栏上移"，很困惑）
                    if (intent.side === side) return;
                    const list = intent.side === 'left' ? layout.left : layout.right;
                    moveCard(cardId, intent.side, list.length);
                    return;
                  }
                  const at = ids.indexOf(cardId);
                  const next = intent.direction === 'up' ? at - 1 : at + 1;
                  if (next < 0 || next >= ids.length) return;
                  moveCard(cardId, side, next);
                }}
              >
                {collapsed ? null : renderCard(cardId)}
              </CardChrome>
            </div>
            {showSeparator && (
              <WeightSeparator
                aboveId={cardId}
                belowId={nextExpanded as string}
                aboveWeight={weight}
                belowWeight={layout.weights[nextExpanded as string] ?? 1}
                onResize={(above, below) =>
                  setCardWeights({
                    ...layout.weights,
                    [cardId]: above,
                    [nextExpanded as string]: below,
                  })
                }
              />
            )}
          </Fragment>
        );
      })}
      {indicator(ids.length)}
    </div>
  );
}

/** 卡片标题栏 + 内容区：标题栏既是拖拽手柄，也是折叠开关（VSCode 同款交互） */
function CardChrome({
  cardId,
  collapsed,
  dragged,
  hint,
  actions,
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyboardMove,
  onToggle,
}: {
  cardId: string;
  collapsed: boolean;
  dragged: boolean;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyboardMove: (intent: KeyboardMoveIntent) => void;
  onToggle: () => void;
}) {
  const label = CARD_LABEL[cardId] ?? cardId;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
      return;
    }
    if (!event.altKey) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onKeyboardMove({ kind: 'reorder', direction: 'up' });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onKeyboardMove({ kind: 'reorder', direction: 'down' });
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      onKeyboardMove({ kind: 'side', side: event.key === 'ArrowLeft' ? 'left' : 'right' });
    }
  };

  return (
    <section
      data-card={cardId}
      className={`flex min-h-0 flex-1 flex-col border-b border-slate-800 ${
        dragged ? 'opacity-40' : ''
      }`}
    >
      <div
        data-drop-item
        data-drop-id={cardId}
        data-card-header
        data-card-id={cardId}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={label}
        title={`${label}｜点击折叠/展开 · 拖动排序（可拖到另一侧栏）· Alt+↑/↓ 换位、Alt+←/→ 换栏`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        className="flex shrink-0 cursor-grab items-center gap-1.5 bg-slate-900/80 px-2 py-1.5 text-left transition select-none hover:bg-slate-800/70 active:cursor-grabbing focus:bg-slate-800/70 focus:outline-none"
      >
        <Icon
          node={uiIcon('chevron-right')}
          size={12}
          className={`shrink-0 text-slate-500 transition-transform ${collapsed ? '' : 'rotate-90'}`}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-300">
          {label}
        </span>
        {hint && <span className="shrink-0 text-[10px] text-slate-600">{hint}</span>}
        {actions && (
          // 标题栏里的按钮不该触发拖拽或折叠
          <span
            className="shrink-0"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
          >
            {actions}
          </span>
        )}
      </div>
      {!collapsed && <div className="flex min-h-0 flex-1 flex-col">{children}</div>}
    </section>
  );
}

/** 「检查器 / 诊断」之间的可拖动分隔条：调的是相邻两张展开卡片的权重 */
function WeightSeparator({
  aboveId,
  belowId,
  aboveWeight,
  belowWeight,
  onResize,
}: {
  aboveId: string;
  belowId: string;
  aboveWeight: number;
  belowWeight: number;
  onResize: (above: number, below: number) => void;
}) {
  const dragging = useRef(false);

  const boxes = () => {
    const above = document.querySelector<HTMLElement>(`[data-card="${aboveId}"]`);
    const below = document.querySelector<HTMLElement>(`[data-card="${belowId}"]`);
    if (!above || !below) return null;
    const a = above.getBoundingClientRect();
    const b = below.getBoundingClientRect();
    if (a.height + b.height < MIN_PANE_PX * 2) return null;
    return { aboveTop: a.top, abovePx: a.height, belowPx: b.height };
  };

  const apply = (desiredAbovePx: number, abovePx: number, belowPx: number) => {
    const region = abovePx + belowPx;
    const [a, b] = weightsFromBoundary([aboveWeight, belowWeight], {
      regionPx: region,
      pointerOffsetPx: Math.max(MIN_PANE_PX, Math.min(region - MIN_PANE_PX, desiredAbovePx)),
    });
    onResize(a, b);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const box = boxes();
    if (!box) return;
    apply(event.clientY - box.aboveTop, box.abovePx, box.belowPx);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const box = boxes();
    if (!box) return;
    const step = event.shiftKey ? KEY_STEP_FAST_PX : KEY_STEP_PX;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      apply(box.abovePx - step, box.abovePx, box.belowPx);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      apply(box.abovePx + step, box.abovePx, box.belowPx);
    }
  };

  const share = Math.round((aboveWeight / (aboveWeight + belowWeight)) * 100);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={`调整「${CARD_LABEL[aboveId] ?? aboveId}」与「${CARD_LABEL[belowId] ?? belowId}」的高度比例`}
      aria-valuenow={share}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      title="拖动调整高度比例（↑/↓ 微调，Shift 加速，双击复位）"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() =>
        onResize(
          DEFAULT_RIGHT_WEIGHTS[aboveId] ?? 1,
          DEFAULT_RIGHT_WEIGHTS[belowId] ?? 1,
        )
      }
      className="h-1.5 shrink-0 cursor-row-resize bg-slate-800 transition hover:bg-sky-500/60 focus:bg-sky-500/60 focus:outline-none"
    />
  );
}
