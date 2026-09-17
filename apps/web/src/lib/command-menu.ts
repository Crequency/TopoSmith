/**
 * 命令菜单的**内容与过滤**（纯数据 + 纯函数，FR-71）
 *
 * 这一版只做 UI：命令列表是**占位**（`wired: false`），点下去不会执行任何操作，
 * 界面上也如实标注"未接入"。为什么不直接塞几条真命令进来看起来更像：
 *  1. 命令面板的价值在"命令集"，不在面板本身；先定 UI 再逐个接命令，
 *     可以把"哪些操作值得进面板"当成一次单独的设计动作，而不是顺手把按钮复制一遍；
 *  2. 面板里放一批"点了没反应"的假命令，比留一句"未接入"更糟 —— 那是骗人。
 *
 * 分组与命名按**用户的动作**来（视图 / 场景 / 编辑 / 诊断 / 布局），
 * 与 VSCode 的"动词 + 对象"一致；过滤是大小写无关的子串匹配
 * （不做拼音与模糊匹配：中文用户的输入就是中文，模糊匹配只会带来惊喜式的误命中）。
 */

export interface MenuCommand {
  id: string;
  label: string;
  /** 分组（显示为一节的小标题） */
  group: string;
  /** 真实快捷键（键帽展示用；面板只是把它显示出来，不负责绑定） */
  shortcut?: string[];
  /** 是否已经接入实现。当前全部为 false —— 面板是 UI 占位 */
  wired: boolean;
}

export const COMMANDS: MenuCommand[] = [
  { id: 'view.fit', label: '适应视图', group: '视图', wired: false },
  { id: 'view.zoom-in', label: '放大', group: '视图', shortcut: ['+'], wired: false },
  { id: 'view.zoom-out', label: '缩小', group: '视图', shortcut: ['-'], wired: false },
  { id: 'view.zoom-reset', label: '复位缩放（100%）', group: '视图', wired: false },
  { id: 'view.snap', label: '切换网格吸附', group: '视图', wired: false },
  { id: 'scenario.presets', label: '预置场景…', group: '场景', wired: false },
  { id: 'scenario.new', label: '新建空场景', group: '场景', wired: false },
  { id: 'scenario.import', label: '导入场景…', group: '场景', wired: false },
  { id: 'scenario.export', label: '导出场景', group: '场景', wired: false },
  { id: 'edit.undo', label: '撤销', group: '编辑', shortcut: ['mod', 'Z'], wired: false },
  { id: 'edit.redo', label: '重做', group: '编辑', shortcut: ['mod', '⇧', 'Z'], wired: false },
  { id: 'edit.select-all', label: '全选设备', group: '编辑', shortcut: ['mod', 'A'], wired: false },
  { id: 'edit.delete', label: '删除选中', group: '编辑', shortcut: ['Delete'], wired: false },
  { id: 'diag.ping', label: '运行可达性诊断', group: '诊断', wired: false },
  { id: 'diag.trace', label: '运行数据包链路', group: '诊断', wired: false },
  { id: 'diag.bandwidth', label: '运行通讯速度', group: '诊断', wired: false },
  { id: 'diag.dns', label: '运行 DNS 解析路径', group: '诊断', wired: false },
  { id: 'diag.clear-cache', label: '清空 DNS 缓存', group: '诊断', wired: false },
  { id: 'layout.reset', label: '重置侧栏布局', group: '布局', wired: false },
  { id: 'layout.collapse-all', label: '折叠全部卡片', group: '布局', wired: false },
  { id: 'layout.expand-all', label: '展开全部卡片', group: '布局', wired: false },
];

export interface CommandSection {
  group: string;
  commands: MenuCommand[];
}

/** 分组顺序：按"用得多的类别"排，而不是按 id 字典序 */
const GROUP_ORDER = ['视图', '场景', '编辑', '诊断', '布局'];

/**
 * 过滤并分组。
 *
 * 空查询 → 全量（面板刚打开时应当能看到"这里有哪些命令"）；
 * 有查询 → 只保留命中项，并丢掉空分组。
 */
export function filterCommands(query: string, commands: MenuCommand[] = COMMANDS): CommandSection[] {
  const needle = query.trim().toLowerCase();
  const hit = needle.length === 0
    ? commands
    : commands.filter(
        (command) =>
          command.label.toLowerCase().includes(needle) ||
          command.id.toLowerCase().includes(needle) ||
          command.group.includes(needle),
      );

  const sections = new Map<string, MenuCommand[]>();
  for (const command of hit) {
    const list = sections.get(command.group);
    if (list) list.push(command);
    else sections.set(command.group, [command]);
  }

  return [...sections.entries()]
    .sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a[0]);
      const bi = GROUP_ORDER.indexOf(b[0]);
      return (ai === -1 ? GROUP_ORDER.length : ai) - (bi === -1 ? GROUP_ORDER.length : bi);
    })
    .map(([group, list]) => ({ group, commands: list }));
}

/** 扁平化后的顺序：键盘上下移动走的就是它 */
export function flattenCommands(sections: CommandSection[]): MenuCommand[] {
  return sections.flatMap((section) => section.commands);
}

/** 未接入的命令数（面板底部据此给出提示；全部接入后提示自动消失） */
export function unwiredCount(commands: MenuCommand[] = COMMANDS): number {
  return commands.filter((command) => !command.wired).length;
}
