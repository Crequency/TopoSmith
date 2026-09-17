/**
 * 左侧栏：页面 + 页签（FR-43 / FR-70）
 *
 * 左栏是"二选一的工作区"：**设备目录**与**节点树**共享这块空间，用页签切换
 * （默认停在设备目录，与旧版一致）。两页都是整页内容：目录一页列全部分组、
 * 整页滚动；节点树一页列全部节点、整页滚动。
 *
 * 页签就是页面的标题，也是**拖拽手柄**：在页签条内拖动换位、拖到右侧栏即把这一页搬走
 * （在那边按堆叠面板呈现），右侧栏的面板标题也能拖回来变成页签。
 */

import { renderSidebarCard } from './cards';
import { SidebarResizer, useSidebarBounds } from './SidebarResizer';
import { SidebarTabs } from './SidebarTabs';

export function LeftPanel() {
  const { width } = useSidebarBounds('left');

  return (
    <>
      <aside
        data-sidebar="left"
        style={{ width }}
        className="flex min-h-0 shrink-0 flex-col bg-slate-900"
      >
        <SidebarTabs renderPage={renderSidebarCard} />
        <div className="shrink-0 border-t border-slate-800 px-3 py-1.5 text-[10px] leading-snug text-slate-600">
          拖设备到画布，或点设备卡片在视口内添加 · 拖动页签可换位 / 换栏
        </div>
      </aside>
      <SidebarResizer side="left" />
    </>
  );
}
