/**
 * 侧栏卡片栈（FR-70）
 *
 * 侧栏里的内容不再是"页签 + 一大块"，而是一叠**卡片**：每张卡片有自己的标题栏，
 * 标题栏可以拖动 —— 在同侧栏内排序、拖到另一侧栏；点一下折叠/展开。这是 VSCode 的做法
 * （资源管理器里的各个分组，以及"把视图拖到次侧栏"），它比页签更合身的地方有两点：
 *
 *  1. 页签一次只能看一个，而"设备目录的分组"和"节点树"经常需要同时看；
 *  2. 顺序与折叠是**用户自己的信息架构** —— 常用的排上面、不常用的折起来，
 *     这件事只有用户知道，所以必须可改、并且记住。
 *
 * 两种布局模式（不是随手定的）：
 *  · `flow`：卡片按内容高度堆叠、整列滚动 —— 设备目录这种短卡片适合它；
 *  · `weighted`：卡片按**权重**分配容器高度、相邻卡片之间可拖 —— 右侧栏用它，
 *    因为 FR-60 要求"检查器与诊断的高度比例可调"，权重正是它的推广形式。
 *
 * 两种模式共用一个组件：拖拽逻辑（命中测试、插入位、跨栏移动）只该有一份实现。
 */

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_CARDS,
  DEFAULT_RIGHT_WEIGHTS,
  MIN_PANE_PX,
  insertionIndex,
  weightsFromBoundary,
  type SidebarSide,
} from '../lib/panels';
import { Icon, uiIcon } from '../lib/icons';
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

/** 两个侧栏栈的 DOM 引用：跨栏拖拽要拿对方的卡片几何做命中测试 */
const stackElements = new Map<SidebarSide, HTMLElement>();

const CARD_LABEL: Record<string, string> = Object.fromEntries(
  DEFAULT_CARDS.map((card) => [card.id, card.title]),
);

export interface SidebarStackProps {
  side: SidebarSide;
  mode: 'flow' | 'weighted';
  renderCard: (cardId: string) => ReactNode;
  /** 标题栏右侧的小字说明（缺省不显示） */
  cardHint?: (cardId: string) => string | undefined;
  /** 标题栏里的操作按钮（例如诊断卡的"清空 DNS 缓存"） */
  cardActions?: (cardId: string) => ReactNode;
}

export function SidebarStack({ side, mode, renderCard, cardHint, cardActions }: SidebarStackProps) {
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

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    stackElements.set(side, element);
    return () => {
      stackElements.delete(side);
    };
  }, [side]);

  const ids = side === 'left' ? layout.left : layout.right;
  const expandedIds = ids.filter((id) => !layout.collapsed[id]);

  /**
   * 指针位置 → 落点（哪一侧、第几格）。
   *
   * 插入位走 `insertionIndex` 的"中线比较"规则，并且**把正在拖的那张卡片排除在外** ——
   * 它还在原位（半透明），但松手后会被移走，所以序号要按"移走之后"的列表算。
   */
  const resolveDrop = useCallback(
    (cardId: string, clientX: number, clientY: number): { side: SidebarSide; index: number } | null => {
      for (const candidate of ['left', 'right'] as SidebarSide[]) {
        const element = stackElements.get(candidate);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        /*
         * 命中的判定必须**同时看 X 与 Y**：两个侧栏栈的纵向范围几乎一样高，
         * 只看 Y 的话指针一离开左栏就仍然"落在左栏里"，跨栏拖动永远走不到右栏
         * （端到端脚本抓到的就是这个：拖到右栏后卡片原地不动）。
         * 横向留 8px 宽容度，纵向留一点，方便"贴着边缘松手"。
         */
        if (clientX < rect.left - 8 || clientX > rect.right + 8) continue;
        if (clientY < rect.top - 8 || clientY > rect.bottom + 8) continue;
        const boxes = [...element.querySelectorAll<HTMLElement>('[data-card-header]')]
          .filter((header) => header.dataset['cardId'] !== cardId)
          .map((header) => {
            const box = header.getBoundingClientRect();
            return { top: box.top, height: box.height };
          });
        return { side: candidate, index: insertionIndex(clientY, boxes) };
      }
      return null;
    },
    [],
  );

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
    drag.target = resolveDrop(drag.cardId, event.clientX, event.clientY);
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
      ref={rootRef}
      data-card-stack={side}
      data-stack-mode={mode}
      className={
        mode === 'weighted'
          ? 'flex min-h-0 flex-1 flex-col'
          : 'flex min-h-0 flex-1 flex-col overflow-y-auto'
      }
    >
      {ids.map((cardId, index) => {
        const collapsed = Boolean(layout.collapsed[cardId]);
        const isDragged = draggingCard?.cardId === cardId;
        const weight = layout.weights[cardId] ?? 1;
        const nextExpanded = expandedIds[expandedIds.indexOf(cardId) + 1];
        const showSeparator = mode === 'weighted' && !collapsed && nextExpanded !== undefined;

        return (
          <Fragment key={cardId}>
            {indicator(index)}
            <div
              style={
                mode === 'weighted' && !collapsed ? { flexGrow: weight, flexBasis: 0 } : undefined
              }
              className={
                mode === 'weighted' && !collapsed
                  ? 'flex min-h-0 flex-col'
                  : 'flex shrink-0 flex-col'
              }
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
