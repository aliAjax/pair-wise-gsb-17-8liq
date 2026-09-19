/**
 * 岩土钻孔编录 —— 领域模型与闭环校验规则（纯函数，不依赖 UI）。
 *
 * 闭环规则：
 * 1. 每孔分层必须从孔口(0m)连续到孔底：层顶深度 = 上层层底，且不得超出孔深。
 * 2. 标贯试验段（顶深起 0.45m）必须落在单一土层内；跨越分层时阻止提交并列出相邻层。
 * 3. 地下水位首次出现后，水位以下松散砂层必须记录护壁方式，缺失则整孔不得冻结。
 * 4. 已冻结钻孔只能新建带原因的修订，旧值保留在修订链快照中。
 */

/** 标贯试验段长度（贯入 0.45m：预打 0.15m + 记录 0.30m） */
export const SPT_SEGMENT_LEN = 0.45;

/** 深度比较容差（m） */
const EPS = 1e-6;

export interface SoilLayer {
  id: string;
  /** 层顶深度 m（由上一层底推导，首层为 0） */
  topDepth: number;
  /** 层底深度 m（末层恒等于孔深） */
  bottomDepth: number;
  /** 岩性名称，如 粉质黏土 / 粉砂 */
  soilName: string;
  /** 密实度或状态：松散/稍密/中密/密实/可塑/硬塑/强风化… */
  density: string;
  /** 土色 */
  color: string;
  /** 岩性描述 */
  description: string;
  /** 护壁方式（水位以下松散砂层必填） */
  casingMethod: string;
}

export interface SptTest {
  id: string;
  /** 试验段顶深 m，试验段为 [topDepth, topDepth + 0.45] */
  topDepth: number;
  /** 标贯击数 N */
  blows: number;
}

/** 冻结/修订时留存的旧值快照 */
export interface BoreholeSnapshot {
  depth: number;
  waterDepth: number | null;
  layers: SoilLayer[];
  spts: SptTest[];
}

export interface Revision {
  id: string;
  revNo: number;
  reason: string;
  createdAt: string;
  /** 本次修订前的旧值 */
  snapshot: BoreholeSnapshot;
}

export type HoleStatus = "draft" | "frozen";

export interface Borehole {
  id: string;
  code: string;
  /** 孔深 m */
  depth: number;
  /** 地下水位埋深 m；null = 未揭露地下水 */
  waterDepth: number | null;
  layers: SoilLayer[];
  spts: SptTest[];
  status: HoleStatus;
  revisions: Revision[];
  createdAt: string;
  frozenAt: string | null;
}

export const DENSITY_OPTIONS = [
  "松散",
  "稍密",
  "中密",
  "密实",
  "流塑",
  "软塑",
  "可塑",
  "硬塑",
  "坚硬",
  "全风化",
  "强风化",
  "中风化",
];

export const CASING_OPTIONS = [
  "泥浆护壁",
  "套管护壁",
  "跟管钻进",
  "植物胶护壁",
  "其他",
];

export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/** 深度显示：最多两位小数 */
export function fmtDepth(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** 由数组顺序推导各层层顶（首层 0），末层层底锁定为孔深 —— 结构上保证分层连续 */
export function syncLayerTops(layers: SoilLayer[], holeDepth: number): SoilLayer[] {
  return layers.map((layer, i) => ({
    ...layer,
    topDepth: i === 0 ? 0 : layers[i - 1].bottomDepth,
    bottomDepth: i === layers.length - 1 ? holeDepth : layer.bottomDepth,
  }));
}

/** 规则 1：分层连续性校验，返回问题列表（空数组 = 通过） */
export function validateLayers(layers: SoilLayer[], holeDepth: number): string[] {
  const problems: string[] = [];
  if (!(holeDepth > 0)) {
    problems.push("孔深必须大于 0");
    return problems;
  }
  if (layers.length === 0) {
    problems.push("至少需要一个分层，且须从孔口连续到孔底");
    return problems;
  }
  layers.forEach((layer, i) => {
    const no = `第${i + 1}层`;
    if (i === 0 && Math.abs(layer.topDepth) > EPS) {
      problems.push(`${no}层顶深度 ${fmtDepth(layer.topDepth)}m 不等于孔口 0m`);
    }
    if (i > 0 && Math.abs(layer.topDepth - layers[i - 1].bottomDepth) > EPS) {
      problems.push(
        `${no}层顶 ${fmtDepth(layer.topDepth)}m 与上层层底 ${fmtDepth(layers[i - 1].bottomDepth)}m 不连续`
      );
    }
    if (!(layer.bottomDepth > layer.topDepth)) {
      problems.push(`${no}层底 ${fmtDepth(layer.bottomDepth)}m 必须大于层顶 ${fmtDepth(layer.topDepth)}m`);
    }
    if (layer.bottomDepth > holeDepth + EPS) {
      problems.push(`${no}层底 ${fmtDepth(layer.bottomDepth)}m 超出孔深 ${fmtDepth(holeDepth)}m`);
    }
    if (!layer.soilName.trim()) problems.push(`${no}缺少岩性名称`);
    if (!layer.density.trim()) problems.push(`${no}缺少密实度/状态`);
  });
  const last = layers[layers.length - 1];
  if (Math.abs(last.bottomDepth - holeDepth) > EPS) {
    problems.push(
      `末层（第${layers.length}层）层底 ${fmtDepth(last.bottomDepth)}m 未到达孔底 ${fmtDepth(holeDepth)}m`
    );
  }
  return problems;
}

/** 与试验段 [top, top+len] 实际相交（厚度方向有重叠）的土层 */
export function layersCrossedBySegment(layers: SoilLayer[], top: number, len: number): SoilLayer[] {
  const segBottom = top + len;
  return layers.filter((l) => l.topDepth < segBottom - EPS && l.bottomDepth > top + EPS);
}

/** 规则 2：单次标贯校验，返回问题列表（空数组 = 可提交） */
export function validateSpt(
  topDepth: number,
  blows: number,
  layers: SoilLayer[],
  holeDepth: number
): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(topDepth) || topDepth < 0) {
    problems.push("试验段顶深必须是不小于 0 的数值");
    return problems;
  }
  const segBottom = topDepth + SPT_SEGMENT_LEN;
  if (segBottom > holeDepth + EPS) {
    problems.push(
      `试验段 ${fmtDepth(topDepth)}–${fmtDepth(segBottom)}m 超出孔深 ${fmtDepth(holeDepth)}m`
    );
  }
  if (!Number.isInteger(blows) || blows < 1) {
    problems.push("标贯击数 N 必须为不小于 1 的整数");
  }
  const crossed = layersCrossedBySegment(layers, topDepth, SPT_SEGMENT_LEN);
  if (crossed.length === 0) {
    problems.push("试验段未落入任何分层，请先修正分层连续性");
  } else if (crossed.length > 1) {
    const detail = crossed
      .map((l) => {
        const idx = layers.indexOf(l) + 1;
        return `第${idx}层 ${l.soilName || "（未命名）"}（${fmtDepth(l.topDepth)}–${fmtDepth(l.bottomDepth)}m）`;
      })
      .join("、");
    problems.push(
      `试验段 ${fmtDepth(topDepth)}–${fmtDepth(segBottom)}m 跨越分层，相邻层：${detail}。请调整试验深度或分层界线`
    );
  }
  return problems;
}

/** 标贯所属土层（恰好落入单层时返回该层，否则 null） */
export function sptHostLayer(layers: SoilLayer[], topDepth: number): SoilLayer | null {
  const crossed = layersCrossedBySegment(layers, topDepth, SPT_SEGMENT_LEN);
  return crossed.length === 1 ? crossed[0] : null;
}

/** 松散砂层：岩性含“砂”且密实度为“松散” */
export function isLooseSand(layer: SoilLayer): boolean {
  return layer.soilName.includes("砂") && layer.density === "松散";
}

/** 规则 3 判定：水位已揭露且该松散砂层有一部分位于水位以下 */
export function layerNeedsCasing(layer: SoilLayer, waterDepth: number | null): boolean {
  return waterDepth !== null && isLooseSand(layer) && layer.bottomDepth > waterDepth + EPS;
}

/** 水位以下缺失护壁方式的松散砂层 */
export function missingCasingLayers(layers: SoilLayer[], waterDepth: number | null): SoilLayer[] {
  if (waterDepth === null) return [];
  return layers.filter((l) => layerNeedsCasing(l, waterDepth) && !l.casingMethod.trim());
}

export interface ChecklistItem {
  key: string;
  label: string;
  pass: boolean;
  details: string[];
}

/** 冻结前整孔校验清单 */
export function freezeChecklist(hole: Borehole): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  const baseProblems: string[] = [];
  if (!hole.code.trim()) baseProblems.push("钻孔编号不能为空");
  if (!(hole.depth > 0)) baseProblems.push("孔深必须大于 0");
  if (hole.waterDepth !== null && (!(hole.waterDepth >= 0) || hole.waterDepth > hole.depth)) {
    baseProblems.push("地下水位埋深须在 0 至孔深之间");
  }
  items.push({ key: "base", label: "基本信息完整（编号 / 孔深 / 水位）", pass: baseProblems.length === 0, details: baseProblems });

  const layerProblems = validateLayers(hole.layers, hole.depth);
  items.push({
    key: "layers",
    label: "分层自孔口连续至孔底，层顶等于上层层底且不超孔深",
    pass: layerProblems.length === 0,
    details: layerProblems,
  });

  const sptProblems = hole.spts.flatMap((s) =>
    validateSpt(s.topDepth, s.blows, hole.layers, hole.depth).map(
      (p) => `标贯 ${fmtDepth(s.topDepth)}m：${p}`
    )
  );
  items.push({
    key: "spt",
    label: "标贯试验段均落在单一土层内",
    pass: sptProblems.length === 0,
    details: sptProblems,
  });

  const missing = missingCasingLayers(hole.layers, hole.waterDepth);
  items.push({
    key: "casing",
    label:
      hole.waterDepth === null
        ? "未揭露地下水，护壁规则不适用"
        : "水位以下松散砂层均已记录护壁方式",
    pass: missing.length === 0,
    details: missing.map((l) => {
      const idx = hole.layers.indexOf(l) + 1;
      return `第${idx}层 ${l.soilName}（${fmtDepth(l.topDepth)}–${fmtDepth(l.bottomDepth)}m，水位 ${fmtDepth(
        hole.waterDepth as number
      )}m 以下）缺少护壁方式`;
    }),
  });

  return items;
}

export function canFreeze(hole: Borehole): boolean {
  return freezeChecklist(hole).every((item) => item.pass);
}

/** 取当前状态快照（作为修订旧值留存） */
export function snapshotOf(hole: Borehole): BoreholeSnapshot {
  return {
    depth: hole.depth,
    waterDepth: hole.waterDepth,
    layers: hole.layers.map((l) => ({ ...l })),
    spts: hole.spts.map((s) => ({ ...s })),
  };
}

/** 显示用状态：已冻结 / 修订中 / 草稿 */
export function holeStatusLabel(hole: Borehole): string {
  if (hole.status === "frozen") return "已冻结";
  return hole.revisions.length > 0 ? "修订中" : "草稿";
}
