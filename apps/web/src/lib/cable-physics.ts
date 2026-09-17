/**
 * 连线的平面物理摆动（纯函数，FR-50）
 *
 * 模型：每条连线记一个**摆动偏移**（世界单位）。连线两端被"插"在端口上，
 * 所以端点不动、只有线身可以甩 —— 偏移直接加在两个控制点上
 * （中段位移 ≈ 0.75×偏移，端点位移 0），这正是"电缆被拽着甩"的样子。
 *
 * 受力：**端点位移给线身一个冲量**（跟得越急，线身被拽住的那一下越强），
 * 弹簧把偏移拉回零，阻尼让它最终停下。松手后没有新的冲量，
 * 于是偏移会**来回摆几下再停** —— 这就是"摇晃"而不是"跟随"。
 *
 * 为什么不做真的质点链：19 个采样点做约束求解，既会在帧率波动时抖动，
 * 又要为"线长守恒"引入一堆参数。这里只有一个二阶系统，
 * 状态可序列化、可单测、帧率无关（用 dt 积分）。
 *
 * 为什么不用"把偏移拉向与速度成正比的目标"（更直觉的"滞后"模型）：
 * **一次很快的甩动可能整段都落在两帧之间** —— 那一帧之后速度归零、目标随之归零，
 * 偏移还没长起来就被拉回去，于是"甩得越快越不动"。位移冲量对两种情形都成立：
 * 稳速拖动有稳定滞后（实测 ≈7.5 世界单位），快甩得到冲量再回摆（实测 ≈60）。
 */

export interface CableSway {
  /** 当前偏移（世界单位） */
  x: number;
  y: number;
  /** 偏移的变化率（世界单位/秒） */
  vx: number;
  vy: number;
}

export interface SwayTuning {
  /** 弹簧刚度（1/s²）：越大回得越快 */
  stiffness: number;
  /** 阻尼（1/s）：越小摆得越久 */
  damping: number;
  /** 每单位端点位移给线身的冲量（1/s）：越大线身跟得越"懒" */
  impulsePerUnit: number;
  /** 偏移上限（世界单位）：保证"瞬移"不会甩出一个大弧 */
  maxOffset: number;
}

/**
 * 默认手感。
 *
 * `stiffness/damping` 的比值决定"摆几次"：临界阻尼约需 `damping = 2√stiffness ≈ 19`，
 * 这里取 7（ζ≈0.37）—— 大约摆 1–2 次，肉眼能看出"晃"，又不至于像果冻。
 * `impulsePerUnit` 决定"跟得有多懒"：稳速拖动时线身大约落后 10–30 世界单位。
 */
export const DEFAULT_SWAY_TUNING: SwayTuning = {
  stiffness: 90,
  damping: 7,
  impulsePerUnit: 9,
  maxOffset: 60,
};

/**
 * 输入速度上限（世界单位/秒）。
 *
 * 有了它，"输入"永远不会离谱：撤销、适应视图、批量重排造成的**瞬移**
 * 会得到一次有界但仍然看得见的甩动，而不是把显式积分推爆。
 */
export const MAX_INPUT_VELOCITY = 2600;

/** 线身速度上限（世界单位/秒） */
export const MAX_SWAY_VELOCITY = 700;

/** 判定"已经停下"的阈值（世界单位 / 世界单位每秒） */
export const SWAY_SETTLE_OFFSET = 0.35;
export const SWAY_SETTLE_VELOCITY = 2;

export function createSway(): CableSway {
  return { x: 0, y: 0, vx: 0, vy: 0 };
}

/**
 * 推进一帧。
 *
 * 模型：**端点位移给线身一个冲量，弹簧与阻尼把线身拉回原位**。
 *   v -= Δ · impulsePerUnit      （Δ = 这一帧端点走了多少世界单位）
 *   v += (-K·p − D·v)·dt
 *   p += v·dt
 *
 * 为什么不是"把偏移拉向与速度成正比的目标"（那种"滞后"模型看起来很自然）：
 * **一次很快的甩动可能整段都落在两帧之间** —— 那一帧之后速度就归零了，
 * 目标随之为零，偏移还没长起来就被拉回去，于是"甩得越快越不动"。
 * 用位移冲量则两种情形都对：稳速拖动有稳定滞后，单帧快甩得到一次冲量然后回摆。
 *
 * @param sway     当前状态（原地修改并返回）
 * @param velocity 连线锚点中点这一帧的速度（世界单位/秒）
 * @param dt       时间步长（秒）
 * @param scale    幅度缩放：短线少甩一点（0–1）
 */
export function stepSway(
  sway: CableSway,
  velocity: { x: number; y: number },
  dt: number,
  scale = 1,
  tuning: SwayTuning = DEFAULT_SWAY_TUNING,
): CableSway {
  // 帧率波动保护：dt 太大（切标签页回来）会让显式积分炸开
  const h = Math.max(0, Math.min(0.05, dt));
  if (h === 0) return sway;

  // 输入速度钳制：再离谱的位移也只会换来一次有界的甩动
  const speed = Math.hypot(velocity.x, velocity.y);
  const shrink = Number.isFinite(speed) && speed > MAX_INPUT_VELOCITY ? MAX_INPUT_VELOCITY / speed : 1;
  const vx = Number.isFinite(velocity.x) ? velocity.x * shrink : 0;
  const vy = Number.isFinite(velocity.y) ? velocity.y * shrink : 0;

  const amplitude = Math.max(0, Math.min(1, scale));
  // 冲量：位移越大，线身被"拽住"的那一下越强
  sway.vx -= vx * h * tuning.impulsePerUnit * amplitude;
  sway.vy -= vy * h * tuning.impulsePerUnit * amplitude;

  const vLimit = MAX_SWAY_VELOCITY;
  sway.vx = clamp(sway.vx, vLimit);
  sway.vy = clamp(sway.vy, vLimit);

  sway.vx += (-sway.x * tuning.stiffness - sway.vx * tuning.damping) * h;
  sway.vy += (-sway.y * tuning.stiffness - sway.vy * tuning.damping) * h;
  sway.x += sway.vx * h;
  sway.y += sway.vy * h;

  const limit = tuning.maxOffset;
  sway.x = clamp(sway.x, limit);
  sway.y = clamp(sway.y, limit);
  return sway;
}

function clamp(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-limit, Math.min(limit, value));
}

/** 是否已经静止（偏移与速度都很小） */
export function isSwaySettled(sway: CableSway): boolean {
  return (
    Math.abs(sway.x) < SWAY_SETTLE_OFFSET &&
    Math.abs(sway.y) < SWAY_SETTLE_OFFSET &&
    Math.abs(sway.vx) < SWAY_SETTLE_VELOCITY &&
    Math.abs(sway.vy) < SWAY_SETTLE_VELOCITY
  );
}

/**
 * 摆动幅度随线长缩放。
 *
 * 很短的连线（同一排的两台设备）甩起来像在抖，所以给它压到 0.25；
 * 长连线按 1 倍甩。用 `span / 160` 线性过渡，不做阶跃。
 */
export function swayScaleForSpan(span: number): number {
  if (!Number.isFinite(span)) return 0;
  return Math.max(0.25, Math.min(1, span / 160));
}
