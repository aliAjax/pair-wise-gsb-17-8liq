// 钻孔分层 / 标准贯入试验 / 地下水位 的领域模型与闭环校验规则。
// 本文件不依赖 React，可单独编译并在 Node 中做逻辑校验。

export interface SoilLayer {
  id: string;
  topDepth: number; // 层顶深度(m)，必须等于上一层层底，首层为 0
  bottomDepth: number; // 层底深度(m)，不得超过孔深
  soilName: string; // 岩性名称
  density: string; // 密实度/状态：松散、稍密、中密、密实、软塑、可塑、硬塑、坚硬
  color: string; // 土色
  casingMethod: string; // 护壁方式，空串 = 未记录
  note: string; // 岩性描述补充
}

export interface SptTest {
  id: string;
  depth: number; // 试验段起深(m)
  segmentLength: number; // 试验段长(m)，标贯常规 0.45m
  blows: number | null; // 标贯击数，null = 未填写
}

export interface HoleSnapshot {
  depth: number; // 孔深(m)
  waterDepth: number | null; // 地下水位埋深(m)，null = 未见水
  layers: SoilLayer[];
  tests: SptTest[];
}

export interface Revision {
  id: string;
  createdAt: string; // ISO 时间
  reason: string; // 修订原因（必填）
  snapshot: HoleSnapshot; // 修订前旧值
}

export interface Borehole extends HoleSnapshot {
  id: string;
  code: string; // 钻孔编号
  frozen: boolean; // 是否已冻结
  revisions: Revision[]; // 修订链，旧值依次保留
}

export interface Issue {
  kind: "layer" | "spt" | "casing" | "general";
  layerId?: string;
  testId?: string;
  message: string;
}

export const EPS = 1e-6;
export const DEFAULT_SEGMENT_LENGTH = 0.45; // 标贯试验段长：预打 15cm + 记录 30cm

export const DENSITIES = ["松散", "稍密", "中密", "密实", "软塑", "可塑", "硬塑", "坚硬"];
export const CASING_METHODS = ["泥浆护壁", "套管护壁", "跟管钻进", "其他"];

export const r3 = (v: number): number => Math.round(v * 1000) / 1000;
export const fmt = (v: number): string => v.toFixed(2);

let seq = 0;
export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newLayer(topDepth: number, bottomDepth: number): SoilLayer {
  return {
    id: uid("layer"),
    topDepth: r3(topDepth),
    bottomDepth: r3(bottomDepth),
    soilName: "",
    density: "中密",
    color: "",
    casingMethod: "",
    note: "",
  };
}

export function newTest(depth = 1): SptTest {
  return { id: uid("spt"), depth, segmentLength: DEFAULT_SEGMENT_LENGTH, blows: null };
}

export function newHole(code: string): Borehole {
  return {
    id: uid("hole"),
    code,
    depth: 20,
    waterDepth: null,
    layers: [newLayer(0, 20)],
    tests: [],
    frozen: false,
    revisions: [],
  };
}

/** 层顶由上一层底递推，保证“层顶 = 上层层底”在编辑后仍成立。 */
export function normalizeTops(layers: SoilLayer[]): SoilLayer[] {
  let top = 0;
  return layers.map((l) => {
    const next = { ...l, topDepth: r3(top) };
    top = l.bottomDepth;
    return next;
  });
}

/** 深度所在层索引：层位按 [层顶, 层底) 归属，孔底归最后一层。 */
export function layerIndexAt(layers: SoilLayer[], depth: number): number {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (depth >= l.topDepth - EPS && depth < l.bottomDepth - EPS) return i;
  }
  const last = layers.length - 1;
  if (last >= 0 && Math.abs(depth - layers[last].bottomDepth) <= EPS) return last;
  return -1;
}

export function layerLabel(layers: SoilLayer[], index: number): string {
  const l = layers[index];
  return `第${index + 1}层 ${l.soilName || "（未命名）"}（${fmt(l.topDepth)}–${fmt(l.bottomDepth)}m）`;
}

/** 规则一：每孔分层必须从孔口连续到孔底，层顶等于上层层底且不超出孔深。 */
export function validateLayers(hole: HoleSnapshot): Issue[] {
  const issues: Issue[] = [];
  const { layers, depth } = hole;
  if (!(depth > 0)) {
    issues.push({ kind: "general", message: "孔深必须大于 0。" });
  }
  if (layers.length === 0) {
    issues.push({ kind: "layer", message: "至少需要一个分层，且从孔口 0.00m 连续到孔底。" });
    return issues;
  }
  let expectedTop = 0;
  layers.forEach((l, i) => {
    if (Math.abs(l.topDepth - expectedTop) > EPS) {
      issues.push({
        kind: "layer",
        layerId: l.id,
        message: `第${i + 1}层层顶 ${fmt(l.topDepth)}m 不等于上层层底 ${fmt(r3(expectedTop))}m，分层必须连续。`,
      });
    }
    if (!(l.bottomDepth > l.topDepth)) {
      issues.push({
        kind: "layer",
        layerId: l.id,
        message: `第${i + 1}层层底 ${fmt(l.bottomDepth)}m 必须大于层顶 ${fmt(l.topDepth)}m。`,
      });
    }
    if (l.bottomDepth - depth > EPS) {
      issues.push({
        kind: "layer",
        layerId: l.id,
        message: `第${i + 1}层层底 ${fmt(l.bottomDepth)}m 超出孔深 ${fmt(depth)}m。`,
      });
    }
    if (!l.soilName.trim()) {
      issues.push({ kind: "layer", layerId: l.id, message: `第${i + 1}层岩性名称未填写。` });
    }
    expectedTop = l.bottomDepth;
  });
  const last = layers[layers.length - 1];
  if (Math.abs(last.bottomDepth - depth) > EPS) {
    issues.push({
      kind: "layer",
      layerId: last.id,
      message: `末层层底 ${fmt(last.bottomDepth)}m 未到达孔底 ${fmt(depth)}m，分层必须连续至孔底。`,
    });
  }
  return issues;
}

/** 规则二：标贯试验深度必须落在所属土层内，试验段不得跨越分层。 */
export function validateSpt(hole: HoleSnapshot, test: SptTest): Issue[] {
  const issues: Issue[] = [];
  const push = (message: string) => issues.push({ kind: "spt", testId: test.id, message });

  if (!(test.depth > 0)) push(`试验深度 ${fmt(test.depth)}m 必须大于 0。`);
  if (test.depth - hole.depth > EPS || Math.abs(test.depth - hole.depth) <= EPS) {
    push(`试验深度 ${fmt(test.depth)}m 不得达到或超出孔底 ${fmt(hole.depth)}m。`);
  }
  if (!(test.segmentLength > 0)) push("试验段长必须大于 0。");
  if (test.blows === null || !(test.blows >= 0)) push("标贯击数未填写。");

  const idx = layerIndexAt(hole.layers, test.depth);
  if (idx < 0) {
    push(`试验深度 ${fmt(test.depth)}m 不在任何分层内。`);
    return issues;
  }
  const layer = hole.layers[idx];
  const end = r3(test.depth + test.segmentLength);
  if (end - hole.depth > EPS) {
    push(`试验段 ${fmt(test.depth)}–${fmt(end)}m 超出孔底 ${fmt(hole.depth)}m。`);
  }
  if (end - layer.bottomDepth > EPS) {
    const next = hole.layers[idx + 1];
    const adjacent = next
      ? `${layerLabel(hole.layers, idx)} 与 ${layerLabel(hole.layers, idx + 1)}`
      : `${layerLabel(hole.layers, idx)}（其下已无分层）`;
    push(
      `试验段 ${fmt(test.depth)}–${fmt(end)}m 跨越层界 ${fmt(layer.bottomDepth)}m，涉及相邻层：${adjacent}。请调整试验深度，使整段落在同一层内。`
    );
  }
  return issues;
}

export function isLooseSand(layer: SoilLayer): boolean {
  return layer.density === "松散" && layer.soilName.includes("砂");
}

/** 规则三：地下水位首次出现后，水位以下的松散砂层必须记录护壁方式。 */
export function casingRequired(hole: HoleSnapshot, layer: SoilLayer): boolean {
  return (
    hole.waterDepth !== null &&
    isLooseSand(layer) &&
    layer.bottomDepth - hole.waterDepth > EPS
  );
}

export function validateCasing(hole: HoleSnapshot): Issue[] {
  if (hole.waterDepth === null) return [];
  return hole.layers
    .filter((l) => casingRequired(hole, l) && !l.casingMethod.trim())
    .map((l) => ({
      kind: "casing" as const,
      layerId: l.id,
      message: `${l.soilName}（${fmt(l.topDepth)}–${fmt(l.bottomDepth)}m）为水位 ${fmt(
        hole.waterDepth as number
      )}m 以下的松散砂层，必须记录护壁方式。`,
    }));
}

/** 冻结前全量校验：任一项不满足则整孔不得冻结。 */
export function freezeBlockers(hole: HoleSnapshot): Issue[] {
  return [
    ...validateLayers(hole),
    ...hole.tests.flatMap((t) => validateSpt(hole, t)),
    ...validateCasing(hole),
  ];
}

export function canFreeze(hole: HoleSnapshot): boolean {
  return freezeBlockers(hole).length === 0;
}

export function snapshotOf(hole: Borehole): HoleSnapshot {
  return {
    depth: hole.depth,
    waterDepth: hole.waterDepth,
    layers: hole.layers.map((l) => ({ ...l })),
    tests: hole.tests.map((t) => ({ ...t })),
  };
}

/** 规则四：已冻结钻孔只能新建带原因的修订，旧值进入修订链保留。 */
export function createRevision(hole: Borehole, reason: string): Borehole {
  const trimmed = reason.trim();
  if (!hole.frozen) throw new Error("仅已冻结钻孔需要新建修订。");
  if (!trimmed) throw new Error("修订原因不能为空。");
  const revision: Revision = {
    id: uid("rev"),
    createdAt: new Date().toISOString(),
    reason: trimmed,
    snapshot: snapshotOf(hole),
  };
  return { ...hole, frozen: false, revisions: [...hole.revisions, revision] };
}

export function freezeHole(hole: Borehole): Borehole | null {
  if (!canFreeze(hole)) return null;
  return { ...hole, frozen: true };
}

// ---------------- 持久化（localStorage 落盘） ----------------

const STORAGE_KEY = "hxwl03.boreholes.v1";

export function saveBoreholes(holes: Borehole[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holes));
  } catch {
    // 存储不可用时静默降级为内存态
  }
}

export function loadBoreholes(): Borehole[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Borehole[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 刷新后重算层顶，保证分层、试验与修订链数据一致
        return parsed.map((h) => ({ ...h, layers: normalizeTops(h.layers ?? []) }));
      }
    }
  } catch {
    // 数据损坏时回退到示例数据
  }
  return seedBoreholes();
}

// ---------------- 示例数据 ----------------

function layer(
  holeId: string,
  n: number,
  top: number,
  bottom: number,
  soilName: string,
  density: string,
  color: string,
  casingMethod = "",
  note = ""
): SoilLayer {
  return { id: `${holeId}-l${n}`, topDepth: top, bottomDepth: bottom, soilName, density, color, casingMethod, note };
}

function spt(id: string, depth: number, blows: number, segmentLength = DEFAULT_SEGMENT_LENGTH): SptTest {
  return { id, depth, segmentLength, blows };
}

export function seedBoreholes(): Borehole[] {
  const zk18: Borehole = {
    id: "zk18",
    code: "ZK-18",
    depth: 22.6,
    waterDepth: 3.4,
    layers: [
      layer("zk18", 1, 0, 1.2, "素填土", "松散", "杂色"),
      layer("zk18", 2, 1.2, 8.5, "粉质黏土", "可塑", "黄褐"),
      // 水位 3.4m 以下的松散砂层：已记录护壁方式
      layer("zk18", 3, 8.5, 12.0, "粉砂", "松散", "灰", "泥浆护壁", "饱和，易塌孔"),
      layer("zk18", 4, 12.0, 16.5, "中砂", "中密", "灰黄"),
      layer("zk18", 5, 16.5, 22.6, "强风化泥岩", "坚硬", "紫红"),
    ],
    tests: [spt("zk18-s1", 9.0, 7), spt("zk18-s2", 13.0, 14), spt("zk18-s3", 17.0, 31)],
    frozen: false,
    revisions: [],
  };

  const zk21: Borehole = {
    id: "zk21",
    code: "ZK-21",
    depth: 31.2,
    waterDepth: 5.8,
    layers: [
      layer("zk21", 1, 0, 0.8, "素填土", "松散", "杂色"),
      layer("zk21", 2, 0.8, 6.4, "粉质黏土", "可塑", "褐黄"),
      layer("zk21", 3, 6.4, 15.0, "卵石", "稍密", "灰", "", "夹中粗砂，取样困难"),
      layer("zk21", 4, 15.0, 24.0, "卵石", "中密", "灰"),
      layer("zk21", 5, 24.0, 31.2, "强风化砂岩", "坚硬", "灰绿"),
    ],
    tests: [spt("zk21-s1", 7.2, 11), spt("zk21-s2", 11.5, 18), spt("zk21-s3", 16.0, 24), spt("zk21-s4", 20.5, 29)],
    frozen: false,
    revisions: [],
  };

  // ZK-24 已冻结，并带一条修订记录，演示修订链保留旧值
  const zk24Base = {
    depth: 18.4,
    waterDepth: null as number | null,
    layers: [
      layer("zk24", 1, 0, 1.5, "杂填土", "松散", "杂色"),
      layer("zk24", 2, 1.5, 9.0, "黏土", "硬塑", "棕红"),
      layer("zk24", 3, 9.0, 18.4, "强风化泥岩", "坚硬", "紫红", "", "芯样完整率62%"),
    ],
  };
  const zk24: Borehole = {
    id: "zk24",
    code: "ZK-24",
    ...zk24Base,
    tests: [spt("zk24-s1", 3.0, 12), spt("zk24-s2", 6.5, 19), spt("zk24-s3", 10.5, 38)],
    frozen: true,
    revisions: [
      {
        id: "zk24-r1",
        createdAt: "2026-09-12T09:30:00.000Z",
        reason: "补录 6.5m 标贯试验并修正黏土状态为硬塑",
        snapshot: {
          ...zk24Base,
          layers: zk24Base.layers.map((l) => ({ ...l })),
          tests: [spt("zk24-s1", 3.0, 12)],
        },
      },
    ],
  };

  return [zk18, zk21, zk24];
}
