/**
 * 右侧栏：检查器 + 连通性诊断（FR-60 / FR-70）
 *
 * 两块内容卡片化之后，"高度比例可调"这件事并没有丢：卡片栈的 `weighted` 模式用
 * **权重**分配高度，而 FR-60 的单条分割线正是 N=2 时的特例 —— 原来的默认比例
 * （1.1 : 1.4 ≈ 44% : 56%）仍然是默认权重，老用户存过的比例也会在迁移时读进来。
 *
 * 卡片标题栏各带一个动作：诊断卡上是"清空 DNS 缓存"（演示缓存命中用），
 * 放在标题栏而不是内容里，是为了让它永远可见、且不占诊断结果的位置。
 */

import { SidebarCardActions, renderSidebarCard, sidebarCardHint } from './cards';
import { SidebarResizer, useSidebarBounds } from './SidebarResizer';
import { SidebarStack } from './SidebarStack';

export function RightSidebar() {
  const { width } = useSidebarBounds('right');

  return (
    <>
      <SidebarResizer side="right" />
      <aside
        data-sidebar="right"
        style={{ width }}
        className="flex min-h-0 shrink-0 flex-col bg-slate-900"
      >
        <SidebarStack
          side="right"
          mode="weighted"
          renderCard={renderSidebarCard}
          cardHint={sidebarCardHint}
          cardActions={(cardId) => <SidebarCardActions cardId={cardId} />}
        />
      </aside>
    </>
  );
}
