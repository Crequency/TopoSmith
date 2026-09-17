/**
 * 侧栏拖拽的落点判定（FR-70）
 *
 * 页面既能在本侧栏内换位，也能拖到**另一侧**（左栏是页签、右栏是堆叠面板，
 * 同一个页面搬过去就换一种排布方式）。因此落点判定必须由两侧共用一份：
 * 各自记住自己的 DOM 容器，拖拽时按指针位置决定"落到哪一侧的第几格"。
 *
 * 关键的一条：命中判定要**同时看 X 与 Y**。两个侧栏的纵向范围几乎一样高，
 * 只看 Y 的话指针一离开左栏仍然"落在左栏里"，跨栏拖动永远走不到另一侧
 * （端到端脚本抓过这个 bug）。
 */

import { insertionIndex, type SidebarSide } from '../lib/panels';

const containers = new Map<SidebarSide, HTMLElement>();

export function registerSidebar(side: SidebarSide, element: HTMLElement | null): void {
  if (element) containers.set(side, element);
  else containers.delete(side);
}

/** 某一侧栏里的"可落点"元素（左栏是页签，右栏是页面标题栏） */
function dropBars(side: SidebarSide): HTMLElement[] {
  const element = containers.get(side);
  if (!element) return [];
  return [...element.querySelectorAll<HTMLElement>('[data-drop-item]')];
}

export interface SidebarDrop {
  side: SidebarSide;
  index: number;
}

/**
 * 指针位置 → 落点。
 *
 * `draggingId` 会被排除在落点序列之外：它还在原位（半透明），但松手后会被移走，
 * 所以序号要按"移走之后"的列表算（与 `moveCardIds` 的语义一致）。
 */
export function resolveSidebarDrop(
  draggingId: string,
  clientX: number,
  clientY: number,
): SidebarDrop | null {
  for (const side of ['left', 'right'] as SidebarSide[]) {
    const element = containers.get(side);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (clientX < rect.left - 8 || clientX > rect.right + 8) continue;
    if (clientY < rect.top - 8 || clientY > rect.bottom + 8) continue;
    const boxes = dropBars(side)
      .filter((bar) => bar.dataset['dropId'] !== draggingId)
      .map((bar) => {
        const box = bar.getBoundingClientRect();
        return { top: box.top, height: box.height };
      });
    return { side, index: insertionIndex(clientY, boxes) };
  }
  return null;
}
