/**
 * 可拖动分割的上下分栏（FR-60）
 *
 * 右侧栏原本是固定比例（`flex-[1.1]` / `flex-[1.4]`）：想多看点诊断结论就得忍着
 * 检查器占的那一半，反之亦然。这里把分割条做成可拖动的，并且：
 *   · 用**像素下限**夹住比例（`lib/layout` 的纯函数，有单测），不会把某一块拖没；
 *   · 比例**记在 localStorage 里**（这是使用偏好，不该每次刷新都变回去）；
 *   · 分割条本身是 `role="separator"`，可以用 ↑/↓ 微调（键盘用户也能改）。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { clampPaneRatio, ratioFromPointer } from '../lib/layout';

const STORAGE_KEY = 'toposmith.ui.sidebarSplit';

function readStored(): number | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function SplitPane({
  top,
  bottom,
  storageKey = STORAGE_KEY,
}: {
  top: ReactNode;
  bottom: ReactNode;
  storageKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => clampPaneRatio(readStored() ?? 0.44, { containerPx: 800 }));
  const dragging = useRef(false);

  // 比例变了就落盘（拖动过程中每帧写一次 localStorage 也无所谓：一个数字）
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(ratio));
    } catch {
      /* 隐私模式等场景下写不进去，不影响使用 */
    }
  }, [ratio, storageKey]);

  const apply = useCallback((next: number) => {
    const height = containerRef.current?.clientHeight ?? 0;
    setRatio(clampPaneRatio(next, { containerPx: height }));
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    apply(ratioFromPointer(event.clientY, box.top, box.height));
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.08 : 0.02;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      apply(ratio - step);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      apply(ratio + step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      apply(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      apply(1);
    }
  };

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      <div style={{ height: `${ratio * 100}%` }} className="flex min-h-0 flex-col border-b border-slate-800">
        {top}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整检查器与诊断的高度比例"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        title="拖动调整高度比例（↑/↓ 微调，Shift 加速）"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={() => apply(0.44)}
        className="group h-1.5 shrink-0 cursor-row-resize bg-slate-800 transition hover:bg-sky-500/60 focus:bg-sky-500/60 focus:outline-none"
      />
      <div className="flex min-h-0 flex-1 flex-col">{bottom}</div>
    </div>
  );
}
