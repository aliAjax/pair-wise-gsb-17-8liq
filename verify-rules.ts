/**
 * 领域规则闭环验证（非交付代码，仅本地校验用）：
 * 规则1 分层连续；规则2 标贯落层；规则3 水位以下松散砂护壁；规则4 冻结-修订链。
 */
import {
  Borehole,
  canFreeze,
  freezeChecklist,
  layersCrossedBySegment,
  missingCasingLayers,
  snapshotOf,
  syncLayerTops,
  uid,
  validateLayers,
  validateSpt,
} from "./src/domain";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`, extra ?? "");
  }
}

function mkLayer(bottom: number, soil: string, density: string, casing = "") {
  return { id: uid(), topDepth: 0, bottomDepth: bottom, soilName: soil, density, color: "", description: "", casingMethod: casing };
}

function mkHole(depth: number, water: number | null, layers: ReturnType<typeof mkLayer>[], spts: { id: string; topDepth: number; blows: number }[]): Borehole {
  return {
    id: uid(), code: "ZK-T", depth, waterDepth: water,
    layers: syncLayerTops(layers, depth), spts,
    status: "draft", revisions: [], createdAt: new Date().toISOString(), frozenAt: null,
  };
}

console.log("规则1：分层连续性");
{
  const layers = syncLayerTops([mkLayer(2, "杂填土", "松散"), mkLayer(6.5, "粉质黏土", "可塑"), mkLayer(10, "粉砂", "松散")], 10);
  check("层顶=上层层底且末层=孔深", validateLayers(layers, 10).length === 0);
  check("首层顶=0", layers[0].topDepth === 0);
  check("末层底=孔深", layers[2].bottomDepth === 10);

  const broken = syncLayerTops([mkLayer(5, "a", "松散"), mkLayer(3, "b", "中密"), mkLayer(8, "c", "密实")], 10);
  const problems = validateLayers(broken, 10);
  check("中间层层底倒置被拦截", problems.some((p) => p.includes("必须大于层顶")), problems);

  const over = syncLayerTops([mkLayer(12, "a", "松散")], 10);
  check("末层被锁到孔深（不超出孔深）", validateLayers(over, 10).length === 0 && over[0].bottomDepth === 10);

  const noName = syncLayerTops([mkLayer(10, "", "")], 10);
  check("缺岩性/状态被拦截", validateLayers(noName, 10).length === 2);
}

console.log("规则2：标贯试验段落层");
{
  const layers = syncLayerTops([mkLayer(6.5, "粉质黏土", "可塑"), mkLayer(10, "粉砂", "松散")], 10);
  check("4.8m 落在第1层内", validateSpt(4.8, 12, layers, 10).length === 0);
  check("恰好止于层界 6.05–6.50m 不算跨层", layersCrossedBySegment(layers, 6.05, 0.45).length === 1);
  const cross = validateSpt(6.3, 12, layers, 10);
  check("6.3–6.75m 跨层被阻止", cross.some((p) => p.includes("跨越分层")), cross);
  check("跨层错误列出相邻两层", cross.some((p) => p.includes("第1层") && p.includes("第2层") && p.includes("粉质黏土") && p.includes("粉砂")), cross);
  check("超出孔深被阻止", validateSpt(9.8, 12, layers, 10).some((p) => p.includes("超出孔深")));
  check("击数非正整数被阻止", validateSpt(4.8, 0, layers, 10).length > 0 && validateSpt(4.8, 2.5, layers, 10).length > 0);
}

console.log("规则3：水位以下松散砂层护壁");
{
  const layers = syncLayerTops(
    [mkLayer(2, "杂填土", "松散"), mkLayer(6.5, "粉质黏土", "可塑"), mkLayer(12, "粉砂", "松散"), mkLayer(18, "中砂", "中密")],
    18
  );
  check("未揭露水位时无需护壁", missingCasingLayers(layers, null).length === 0);
  const missing = missingCasingLayers(layers, 3.4);
  check("水位3.4m：仅松散粉砂层缺护壁", missing.length === 1 && missing[0].soilName === "粉砂", missing.map((l) => l.soilName));
  const fixed = layers.map((l) => (l.soilName === "粉砂" ? { ...l, casingMethod: "泥浆护壁" } : l));
  check("补录护壁后通过", missingCasingLayers(fixed, 3.4).length === 0);
  check("中密砂层不受限", missing.every((l) => l.soilName !== "中砂"));
}

console.log("规则4：冻结—修订链闭环");
{
  const hole = mkHole(10, 3.4, [mkLayer(6.5, "粉质黏土", "可塑"), mkLayer(10, "粉砂", "松散", "泥浆护壁")], [{ id: uid(), topDepth: 4.8, blows: 12 }]);
  check("校验齐全可冻结", canFreeze(hole), freezeChecklist(hole).filter((i) => !i.pass));

  const noCasing = mkHole(10, 3.4, [mkLayer(6.5, "粉质黏土", "可塑"), mkLayer(10, "粉砂", "松散")], []);
  check("缺护壁整孔不得冻结", !canFreeze(noCasing));

  const frozen: Borehole = { ...hole, status: "frozen", frozenAt: new Date().toISOString() };
  // 冻结后只能新建带原因的修订：旧值进快照，状态回到可编辑
  const revised: Borehole = {
    ...frozen,
    status: "draft",
    waterDepth: 3.1,
    revisions: [{ id: uid(), revNo: 1, reason: "水位复核", createdAt: new Date().toISOString(), snapshot: snapshotOf(frozen) }],
  };
  check("修订保留旧水位 3.4", revised.revisions[0].snapshot.waterDepth === 3.4);
  check("修订保留旧分层快照", revised.revisions[0].snapshot.layers.length === 2 && revised.revisions[0].snapshot.layers[1].soilName === "粉砂");
  check("修订后当前值可更新", revised.waterDepth === 3.1);
  const refrozen: Borehole = { ...revised, status: "frozen", frozenAt: new Date().toISOString() };
  check("修订后重新冻结", refrozen.status === "frozen" && canFreeze(refrozen));
  // 模拟刷新：序列化往返后修订链一致
  const restored: Borehole = JSON.parse(JSON.stringify(refrozen));
  check(
    "刷新（JSON 往返）后分层/试验/修订链一致",
    restored.layers.length === 2 &&
      restored.spts.length === 1 &&
      restored.revisions.length === 1 &&
      restored.revisions[0].snapshot.waterDepth === 3.4 &&
      restored.waterDepth === 3.1
  );
}

if (failures > 0) {
  console.error(`\n${failures} 项校验失败`);
  process.exit(1);
}
console.log("\n全部规则校验通过");
