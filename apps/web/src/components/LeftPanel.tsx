/**
 * 左侧栏：设备目录（分组卡片）+ 节点树（FR-43 / FR-70）
 *
 * 原来这里是「设备目录 / 节点树」两个页签。改成卡片栈之后：
 *  · 每个设备分组是一张卡片 —— 常用分组拖到上面、不常用的折起来；
 *  · 节点树也是一张卡片，可以与目录同时看（页签做不到）；
 *  · 卡片能拖到右侧栏（等价于 VSCode 里"把视图拖到次侧栏"）。
 *
 * 节点树默认**折叠**：它是全量渲染的列表（中型 IDC 场景 810 行 ≈ 1.5 万个 DOM 节点，
 * 见 docs/08-roadmap.md 的规模数据），没必要在用户没看它的时候就付这份钱；
 * 这也与旧版"默认停在设备目录页签"的行为一致。
 */

import { SidebarCardActions, renderSidebarCard, sidebarCardHint } from './cards';
import { SidebarResizer, useSidebarBounds } from './SidebarResizer';
import { SidebarStack } from './SidebarStack';

export function LeftPanel() {
  const { width } = useSidebarBounds('left');

  return (
    <>
      <aside
        data-sidebar="left"
        style={{ width }}
        className="flex min-h-0 shrink-0 flex-col bg-slate-900"
      >
        <SidebarStack
          side="left"
          mode="flow"
          renderCard={renderSidebarCard}
          cardHint={sidebarCardHint}
          cardActions={(cardId) => <SidebarCardActions cardId={cardId} />}
        />
        <div className="shrink-0 border-t border-slate-800 px-3 py-1.5 text-[10px] leading-snug text-slate-600">
          拖设备到画布，或点设备卡片在视口内添加 · 拖动卡片标题可排序 / 换栏
        </div>
      </aside>
      <SidebarResizer side="left" />
    </>
  );
}
