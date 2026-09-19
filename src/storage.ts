import {
  Borehole,
  SoilLayer,
  SptTest,
  snapshotOf,
  syncLayerTops,
  uid,
} from "./domain";

const STORAGE_KEY = "hxwl03.boreholes.v1";

function layer(
  bottomDepth: number,
  soilName: string,
  density: string,
  color: string,
  description: string,
  casingMethod = ""
): SoilLayer {
  return { id: uid(), topDepth: 0, bottomDepth, soilName, density, color, description, casingMethod };
}

function spt(topDepth: number, blows: number): SptTest {
  return { id: uid(), topDepth, blows };
}

function makeHole(
  code: string,
  depth: number,
  waterDepth: number | null,
  layers: SoilLayer[],
  spts: SptTest[],
  status: Borehole["status"],
  createdAt: string
): Borehole {
  return {
    id: uid(),
    code,
    depth,
    waterDepth,
    layers: syncLayerTops(layers, depth),
    spts,
    status,
    revisions: [],
    createdAt,
    frozenAt: status === "frozen" ? createdAt : null,
  };
}

/** 首次打开的示例数据：覆盖草稿、已冻结（含修订链）两种状态 */
export function seedHoles(): Borehole[] {
  const zk18 = makeHole(
    "ZK-18",
    22.6,
    3.4,
    [
      layer(2.0, "杂填土", "松散", "灰褐", "含砖渣、碎石，土质不均"),
      layer(6.5, "粉质黏土", "可塑", "黄褐", "切面稍光滑，夹铁锰结核"),
      layer(12.0, "粉砂", "松散", "灰黄", "饱和，摇振反应迅速，钻进易塌孔"),
      layer(18.0, "中砂", "中密", "灰白", "级配一般，含少量砾石"),
      layer(22.6, "泥岩", "强风化", "紫红", "岩芯呈土柱状，手掰可断"),
    ],
    [spt(4.8, 12), spt(8.0, 9), spt(15.0, 24)],
    "draft",
    "2026-09-12T08:30:00.000Z"
  );
  // ZK-18 的粉砂层位于水位以下且为松散，故意不填护壁方式，用于演示冻结拦截。

  const zk21Layers = [
    layer(3.0, "素填土", "松散", "灰黄", "以黏性土为主，含植物根"),
    layer(9.0, "粉质黏土", "硬塑", "棕红", "切面光滑，韧性中等"),
    layer(16.0, "中粗砂", "稍密", "灰黄", "饱和，含云母碎片", "泥浆护壁"),
    layer(24.0, "卵石", "中密", "灰白", "粒径 2–6cm，磨圆好，充填中粗砂", "套管护壁"),
    layer(31.2, "砂岩", "强风化", "灰绿", "岩芯碎块状，RQD 约 35%"),
  ];
  const zk21 = makeHole(
    "ZK-21",
    31.2,
    5.8,
    zk21Layers,
    [spt(12.0, 18), spt(20.0, 31)],
    "frozen",
    "2026-09-05T09:10:00.000Z"
  );
  zk21.frozenAt = "2026-09-15T14:20:00.000Z";
  // 修订链示例：修订前水位为 6.2m、仅有 12.0m 一次标贯
  const zk21Before = makeHole(
    "ZK-21",
    31.2,
    6.2,
    zk21Layers.map((l) => ({ ...l })),
    [spt(12.0, 18)],
    "frozen",
    "2026-09-05T09:10:00.000Z"
  );
  zk21.revisions = [
    {
      id: uid(),
      revNo: 1,
      reason: "水位观测复核后由 6.2m 修正为 5.8m，并补充 20.0m 标贯数据",
      createdAt: "2026-09-15T14:20:00.000Z",
      snapshot: snapshotOf(zk21Before),
    },
  ];

  const zk24 = makeHole(
    "ZK-24",
    18.4,
    null,
    [
      layer(1.5, "耕土", "松散", "灰黑", "含植物根系"),
      layer(8.0, "粉质黏土", "硬塑", "棕黄", "夹少量铁锰质斑点"),
      layer(18.4, "泥岩", "强风化", "紫红", "岩芯完整率约 62%"),
    ],
    [spt(6.0, 15)],
    "draft",
    "2026-09-17T10:05:00.000Z"
  );

  return [zk18, zk21, zk24];
}

function isValidShape(holes: unknown): holes is Borehole[] {
  return (
    Array.isArray(holes) &&
    holes.every(
      (h) =>
        h &&
        typeof h.id === "string" &&
        typeof h.code === "string" &&
        typeof h.depth === "number" &&
        Array.isArray(h.layers) &&
        Array.isArray(h.spts) &&
        Array.isArray(h.revisions) &&
        (h.status === "draft" || h.status === "frozen")
    )
  );
}

/** 从 localStorage 读取；数据缺失或损坏时回退到示例数据 */
export function loadHoles(): Borehole[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedHoles();
    const parsed: unknown = JSON.parse(raw);
    if (!isValidShape(parsed)) return seedHoles();
    return parsed;
  } catch {
    return seedHoles();
  }
}

export function saveHoles(holes: Borehole[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holes));
  } catch {
    // 存储不可用（如隐私模式）时静默降级为内存态
  }
}

export function resetHoles(): Borehole[] {
  const holes = seedHoles();
  saveHoles(holes);
  return holes;
}
