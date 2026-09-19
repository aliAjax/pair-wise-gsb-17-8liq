// 闭环规则逻辑校验：node scripts/logic-check.cjs
// 先执行：npx tsc src/lib/borehole.ts --outDir /tmp/bhcheck --module commonjs --target es2019 --skipLibCheck
const assert = require("node:assert/strict");
const bh = require("/tmp/bhcheck/borehole.js");

const mkLayer = (top, bottom, soilName, density = "中密", casing = "") => ({
  id: `l${top}`,
  topDepth: top,
  bottomDepth: bottom,
  soilName,
  density,
  color: "",
  casingMethod: casing,
  note: "",
});
const mkTest = (depth, segmentLength = 0.45, blows = 10) => ({ id: `t${depth}`, depth, segmentLength, blows });
const mkHole = (over = {}) => ({
  id: "h1",
  code: "ZK-T",
  depth: 10,
  waterDepth: null,
  layers: bh.normalizeTops([mkLayer(0, 4, "粉质黏土", "可塑"), mkLayer(4, 10, "粉砂", "松散")]),
  tests: [],
  frozen: false,
  revisions: [],
  ...over,
});

// 规则一：分层必须从孔口连续到孔底
{
  const ok = mkHole();
  assert.equal(bh.validateLayers(ok).length, 0, "连续分层应通过");

  const gap = mkHole();
  gap.layers[1].topDepth = 4.5; // 层顶不等于上层层底
  assert.ok(bh.validateLayers(gap).some((i) => i.message.includes("不等于上层层底")), "层间断开应被拦截");

  const short = mkHole({ depth: 12 }); // 末层 10m 未到孔底 12m
  assert.ok(bh.validateLayers(short).some((i) => i.message.includes("连续至孔底")), "未到孔底应被拦截");

  const over = mkHole({ depth: 8 }); // 层底 10m 超出孔深 8m
  assert.ok(bh.validateLayers(over).some((i) => i.message.includes("超出孔深")), "超出孔深应被拦截");
}

// 规则二：标贯深度落层，跨层阻止并列出相邻层
{
  const hole = mkHole();
  assert.equal(bh.validateSpt(hole, mkTest(3.0)).length, 0, "层内试验应通过");

  const cross = bh.validateSpt(hole, mkTest(3.8)); // 3.8–4.25 跨越 4.0m 层界
  assert.ok(cross.some((i) => i.message.includes("跨越层界")), "跨层应被拦截");
  assert.ok(cross.some((i) => i.message.includes("第1层") && i.message.includes("第2层")), "应列出相邻两层");

  const out = bh.validateSpt(hole, mkTest(12));
  assert.ok(out.some((i) => i.message.includes("孔底")), "超出孔底应被拦截");

  const noBlows = bh.validateSpt(hole, mkTest(2, 0.45, null));
  assert.ok(noBlows.some((i) => i.message.includes("击数")), "缺击数应被拦截");
}

// 规则三：水位以下松散砂层必须记录护壁方式，否则整孔不得冻结
{
  const dry = mkHole();
  assert.equal(bh.validateCasing(dry).length, 0, "未见水不强制护壁");

  const wet = mkHole({ waterDepth: 3.4 });
  assert.equal(bh.validateCasing(wet).length, 1, "水位以下松散砂缺护壁应被拦截");
  assert.equal(bh.canFreeze(wet), false, "缺护壁整孔不得冻结");

  const cased = mkHole({ waterDepth: 3.4 });
  cased.layers[1].casingMethod = "泥浆护壁";
  assert.equal(bh.validateCasing(cased).length, 0, "记录护壁后通过");

  const dense = mkHole({ waterDepth: 3.4 });
  dense.layers[1].density = "密实";
  assert.equal(bh.validateCasing(dense).length, 0, "非松散砂不强制护壁");
}

// 规则四：冻结后只能新建带原因修订，旧值保留在修订链
{
  let hole = mkHole({ waterDepth: 3.4 });
  hole.layers[1].casingMethod = "跟管钻进";
  hole.tests = [mkTest(2.0, 0.45, 9)];
  const frozen = bh.freezeHole(hole);
  assert.ok(frozen && frozen.frozen, "满足条件应可冻结");

  assert.throws(() => bh.createRevision(frozen, "  "), /修订原因不能为空/, "空原因修订应被拒绝");

  const revised = bh.createRevision(frozen, "补录水位观测");
  assert.equal(revised.frozen, false, "修订后解锁待重新冻结");
  assert.equal(revised.revisions.length, 1, "修订链应新增一条");
  assert.deepEqual(revised.revisions[0].snapshot.layers, frozen.layers, "旧分层值应保留");
  assert.deepEqual(revised.revisions[0].snapshot.tests, frozen.tests, "旧标贯值应保留");

  // 修订后修改数据并重新冻结，修订链仍在
  const edited = { ...revised, waterDepth: 3.1 };
  const refrozen = bh.freezeHole(edited);
  assert.ok(refrozen && refrozen.frozen && refrozen.revisions.length === 1, "重新冻结后修订链保持");
}

// 持久化：保存→加载后分层、试验、修订链一致
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  const hole = mkHole({ waterDepth: 2.0 });
  hole.layers[1].casingMethod = "套管护壁";
  hole.tests = [mkTest(5.0, 0.45, 12)];
  const frozen = bh.freezeHole(hole);
  const revised = bh.createRevision(frozen, "测试修订链持久化");
  bh.saveBoreholes([revised]);
  const [loaded] = bh.loadBoreholes();
  assert.deepEqual(loaded.layers, revised.layers, "刷新后分层一致");
  assert.deepEqual(loaded.tests, revised.tests, "刷新后标贯一致");
  assert.deepEqual(loaded.revisions, revised.revisions, "刷新后修订链一致");
}

console.log("✓ 全部闭环规则校验通过");
