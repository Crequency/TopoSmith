/**
 * TopoSmith 主界面
 *
 * 布局：顶部工具栏 / 左侧设备目录 / 中间画布 / 右侧「检查器 + 诊断」。
 * 两侧侧栏的宽度可拖（FR-69），侧栏内容是**卡片栈**（FR-70）：
 * 卡片标题可拖动排序、可拖到另一侧栏、可折叠 —— 右侧栏的卡片之间还能拖高度比例。
 * 命令菜单（FR-71）挂在最外层，`Ctrl/Cmd+Shift+P` 由画布的全局键盘处理触发。
 */

import { useEffect } from 'react';
import { TopologyCanvas } from './render/Canvas';
import { CommandPalette } from './components/CommandPalette';
import { LeftPanel } from './components/LeftPanel';
import { RightSidebar } from './components/RightSidebar';
import { Toast } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import { useApp } from './state/store';

export default function App() {
  const fitView = useApp((s) => s.fitView);
  const resetScenario = useApp((s) => s.resetScenario);
  const hasStored = useApp((s) => s.scenario.devices.length > 0);

  // 初次挂载：如果没有历史拓扑，直接给出预置场景的合适视野
  useEffect(() => {
    if (hasStored) fitView();
    // 只在挂载时执行一次：后续的视野由用户控制
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-950 text-slate-100">
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        <LeftPanel />

        <main className="relative min-w-0 flex-1">
          <TopologyCanvas />

          {!hasStored && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-6 text-center">
                <h2 className="text-sm font-semibold text-slate-200">画布是空的</h2>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-400">
                  从左侧设备目录拖入设备，用「连线」按钮连接端口；
                  或者直接加载预置的家庭网络场景看四类诊断怎么工作。
                </p>
                <div className="mt-3 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={resetScenario}
                    className="rounded-md border border-sky-500 bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
                  >
                    加载预置场景
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

        <RightSidebar />
      </div>

      <CommandPalette />
      <Toast />
    </div>
  );
}
