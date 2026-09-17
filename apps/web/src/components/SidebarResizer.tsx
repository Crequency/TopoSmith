/**
 * 侧栏宽度拖拽（FR-69）
 *
 * 两侧侧栏都长在画布上，宽度是**使用偏好**：有人要目录宽一点看设备名，
 * 有人要检查器宽一点看 IP 与端口表。于是宽度做成可拖、可键盘调、可复位，并落盘。
 *
 * 三个细节决定了它好不好用：
 *  1. **跟手**：拖动量 = 指针位移，不做任何惯性/吸附（侧栏宽度是像素量，不需要魔法）；
 *  2. **拖不坏**：宽度由 `clampSidebarWidth` 夹住（用户上限 / 画布下限），
 *     窗口变小之后旧宽度不会把画布挤没 —— 夹取在读取时也做一遍，不只写在拖拽里；
 *  3. **键盘可达**：`←/→` 微调（Shift 加速），`Home/End` 到两端，双击复位到默认宽度
 *     （与 FR-60 的分割条同一套交互语言）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_LEFT_W,
  DEFAULT_RIGHT_W,
  SIDEBAR_MIN_W,
  clampSidebarWidth,
  sidebarMaxWidth,
  type SidebarSide,
} from '../lib/panels';
import { useApp } from '../state/store';

const KEY_STEP_PX = 8;
const KEY_STEP_FAST_PX = 32;

/**
 * 侧栏的实际宽度：读盘值 + **当前窗口**下夹取。
 *
 * 监听 window resize 而不是元素尺寸：夹取的输入是窗口宽度（另外两块的宽度是已知的），
 * 这样"把窗口拉窄 → 侧栏自动收窄、画布保住下限"，拉宽之后又回到用户设定的宽度。
 */
/** 当前窗口宽度（夹取与 aria-valuemax 都要用） */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export interface SidebarBounds {
  width: number;
  min: number;
  max: number;
}

/**
 * 侧栏的实际宽度与合法区间：读盘值 + **当前窗口**下夹取。
 *
 * 监听 window resize 而不是元素尺寸：夹取的输入是窗口宽度（另一侧的宽度也是已知的），
 * 于是"把窗口拉窄 → 侧栏自动收窄、画布保住下限"，拉宽之后又回到用户设定的宽度。
 */
export function useSidebarBounds(side: SidebarSide): SidebarBounds {
  const layout = useApp((s) => s.uiLayout);
  const windowPx = useWindowWidth();
  const raw = side === 'left' ? layout.leftWidth : layout.rightWidth;
  const oppositePx = side === 'left' ? layout.rightWidth : layout.leftWidth;
  return {
    width: clampSidebarWidth(raw, { windowPx, oppositePx }),
    min: SIDEBAR_MIN_W,
    max: sidebarMaxWidth({ windowPx, oppositePx }),
  };
}

export function SidebarResizer({ side }: { side: SidebarSide }) {
  const { width, min, max } = useSidebarBounds(side);
  const setSidebarWidth = useApp((s) => s.setSidebarWidth);
  const dragging = useRef(false);
  const start = useRef({ pointer: 0, width: 0 });

  const label = side === 'left' ? '调整左侧栏宽度' : '调整右侧栏宽度';

  const apply = useCallback(
    (next: number) => setSidebarWidth(side, next),
    [setSidebarWidth, side],
  );

  /** 拖右边缘向右 = 变宽；拖左边缘向左 = 变宽 —— 让边界始终"跟着指针走" */
  const deltaToWidth = (deltaX: number): number => (side === 'left' ? deltaX : -deltaX);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragging.current = true;
    start.current = { pointer: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    apply(start.current.width + deltaToWidth(event.clientX - start.current.pointer));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_FAST_PX : KEY_STEP_PX;
    const wider = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const narrower = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === wider) {
      event.preventDefault();
      apply(width + step);
    } else if (event.key === narrower) {
      event.preventDefault();
      apply(width - step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      apply(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      apply(max);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`拖动调整宽度（←/→ 微调，Shift 加速，双击复位）· 当前 ${width}px`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => apply(side === 'left' ? DEFAULT_LEFT_W : DEFAULT_RIGHT_W)}
      className={`group relative z-10 w-1.5 shrink-0 cursor-col-resize bg-slate-800 transition hover:bg-sky-500/60 focus:bg-sky-500/60 focus:outline-none ${
        side === 'left' ? 'order-last' : ''
      }`}
    >
      {/* 命中区比视觉宽一点：1.5px 的线真的很难点 */}
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
