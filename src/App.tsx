import { useEffect, useState } from "react";
import "./styles.css";
import {
  Borehole,
  BoreholeSnapshot,
  CASING_OPTIONS,
  DENSITY_OPTIONS,
  SPT_SEGMENT_LEN,
  SoilLayer,
  canFreeze,
  fmtDepth,
  freezeChecklist,
  holeStatusLabel,
  layerNeedsCasing,
  snapshotOf,
  sptHostLayer,
  syncLayerTops,
  uid,
  validateLayers,
  validateSpt,
} from "./domain";
import { loadHoles, resetHoles, saveHoles } from "./storage";

const project = {
  id: "hxwl-03",
  port: 5103,
  title: "岩土钻孔编录",
  subtitle:
    "钻孔分层、标准贯入试验与地下水位的现场记录闭环：分层自孔口连续至孔底，标贯试验段落层校验，水位以下松散砂层强制护壁，冻结后仅可留痕修订。",
  stack: "React + Vite + TypeScript + CSS",
  domain: "岩土工程",
  users: ["岩土工程师", "现场编录员", "项目负责人"],
  lithologyFilters: ["黏土", "粉砂", "卵石", "强风化"],
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

/** 数字输入：内部保留文本态，提交合法数值；allowEmpty 时空值提交 null */
function NumberField({
  value,
  onCommit,
  disabled,
  placeholder,
  allowEmpty,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText((prev) => {
      if (prev.trim() !== "" && Number(prev) === value) return prev;
      return value === null ? "" : String(value);
    });
  }, [value]);
  return (
    <input
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      inputMode="decimal"
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") {
          if (allowEmpty) onCommit(null);
          return;
        }
        const n = Number(t);
        if (Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => setText(value === null ? "" : String(value))}
    />
  );
}

function MetricCard({ label, value, index }: { label: string; value: string; index: number }) {
  const statusColors = ["status-ok", "status-watch", "status-danger"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={statusColors[index % statusColors.length]} />
    </article>
  );
}

function StatusChip({ hole }: { hole: Borehole }) {
  const cls =
    hole.status === "frozen" ? "chip-frozen" : hole.revisions.length > 0 ? "chip-revising" : "chip-draft";
  return <span className={`status-chip ${cls}`}>{holeStatusLabel(hole)}</span>;
}

type Update = (fn: (h: Borehole) => Borehole) => void;

/* ---------------- 基本属性 ---------------- */

function BasicPanel({ hole, locked, update, onDelete }: { hole: Borehole; locked: boolean; update: Update; onDelete: () => void }) {
  const deletable = hole.status === "draft" && hole.revisions.length === 0;
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>{project.domain}</p>
          <h2>{hole.code} · 基本属性</h2>
        </div>
        <div className="toolbar">
          <StatusChip hole={hole} />
          {deletable && (
            <button className="danger-btn" onClick={onDelete}>
              删除草稿
            </button>
          )}
        </div>
      </div>
      {locked && (
        <p className="locked-banner">
          本孔已于 {hole.frozenAt ? fmtTime(hole.frozenAt) : "—"} 冻结，内容只读。如需修改，请在下方“冻结与修订”面板新建带原因的修订。
        </p>
      )}
      <div className="field-grid">
        <label>
          <span>钻孔编号</span>
          <input value={hole.code} disabled={locked} onChange={(e) => update((h) => ({ ...h, code: e.target.value }))} />
        </label>
        <label>
          <span>孔深 m（末层层底自动同步为孔底）</span>
          <NumberField
            value={hole.depth}
            disabled={locked}
            onCommit={(v) => {
              if (v !== null && v > 0) update((h) => ({ ...h, depth: v, layers: syncLayerTops(h.layers, v) }));
            }}
          />
        </label>
        <label>
          <span>地下水位埋深 m（留空 = 未揭露）</span>
          <NumberField
            value={hole.waterDepth}
            allowEmpty
            disabled={locked}
            placeholder="未揭露地下水"
            onCommit={(v) => update((h) => ({ ...h, waterDepth: v }))}
          />
        </label>
        <label>
          <span>冻结时间</span>
          <input value={hole.frozenAt ? fmtTime(hole.frozenAt) : "未冻结"} disabled readOnly />
        </label>
      </div>
    </section>
  );
}

/* ---------------- 冻结与修订 ---------------- */

function FreezePanel({ hole, update }: { hole: Borehole; update: Update }) {
  const items = freezeChecklist(hole);
  const ok = items.every((i) => i.pass);
  const [revising, setRevising] = useState(false);
  const [reason, setReason] = useState("");

  const confirmRevision = () => {
    const r = reason.trim();
    if (!r) return;
    update((h) => ({
      ...h,
      status: "draft",
      revisions: [
        ...h.revisions,
        { id: uid(), revNo: h.revisions.length + 1, reason: r, createdAt: new Date().toISOString(), snapshot: snapshotOf(h) },
      ],
    }));
    setRevising(false);
    setReason("");
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>闭环控制</p>
          <h2>冻结与修订</h2>
        </div>
        {hole.status === "frozen" ? (
          <button className="primary-action" onClick={() => setRevising((v) => !v)}>
            新建修订
          </button>
        ) : (
          <button
            className="primary-action"
            disabled={!ok}
            title={ok ? "校验全部通过，可冻结" : "请先解决下方未通过的校验项"}
            onClick={() =>
              update((h) => (canFreeze(h) ? { ...h, status: "frozen", frozenAt: new Date().toISOString() } : h))
            }
          >
            冻结钻孔
          </button>
        )}
      </div>

      <ul className="checklist">
        {items.map((item) => (
          <li key={item.key} className={item.pass ? "pass" : "fail"}>
            <strong>
              {item.pass ? "✓" : "✗"} {item.label}
            </strong>
            {item.details.length > 0 && (
              <ul>
                {item.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {hole.status === "frozen" && revising && (
        <div className="revision-form">
          <label>
            <span>修订原因（必填；修订前的旧值将保留在修订链中）</span>
            <textarea
              rows={3}
              value={reason}
              placeholder="例如：水位观测复核后修正埋深，并补充标贯数据"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="toolbar">
            <button className="primary-action" disabled={!reason.trim()} onClick={confirmRevision}>
              确认建立修订并解锁编辑
            </button>
            <button
              onClick={() => {
                setRevising(false);
                setReason("");
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {hole.status === "frozen" && !revising && (
        <p className="hint">已冻结钻孔不可直接编辑；新建修订并填写原因后自动解锁，修改完成重新冻结即闭环。</p>
      )}
    </section>
  );
}

/* ---------------- 分层 ---------------- */

function LayerCard({
  layer,
  index,
  isLast,
  onlyOne,
  locked,
  waterDepth,
  update,
  onInsertBelow,
  onRemove,
}: {
  layer: SoilLayer;
  index: number;
  isLast: boolean;
  onlyOne: boolean;
  locked: boolean;
  waterDepth: number | null;
  update: Update;
  onInsertBelow: () => void;
  onRemove: () => void;
}) {
  const needCasing = layerNeedsCasing(layer, waterDepth);
  const casingMissing = needCasing && !layer.casingMethod.trim();
  const patch = (p: Partial<SoilLayer>) =>
    update((h) => ({
      ...h,
      layers: syncLayerTops(
        h.layers.map((l, i) => (i === index ? { ...l, ...p } : l)),
        h.depth
      ),
    }));

  return (
    <article className={casingMissing ? "layer-card layer-warn" : "layer-card"}>
      <header className="layer-head">
        <strong>
          第{index + 1}层 · {fmtDepth(layer.topDepth)}–{fmtDepth(layer.bottomDepth)}m
        </strong>
        <span className="hint">层厚 {fmtDepth(layer.bottomDepth - layer.topDepth)}m</span>
        {needCasingBadge(needCasing, casingMissing)}
        <span className="toolbar">
          <button disabled={locked} onClick={onInsertBelow} title="在本层中部插入一条新的分层界线">
            插入新层
          </button>
          <button disabled={locked || onlyOne} onClick={onRemove} title={onlyOne ? "至少保留一个分层" : "删除本层，区间并入下一层"}>
            删除本层
          </button>
        </span>
      </header>
      <div className="layer-fields">
        <label>
          <span>层顶深度 m（= 上层层底）</span>
          <input value={fmtDepth(layer.topDepth)} disabled readOnly />
        </label>
        <label>
          <span>层底深度 m{isLast ? "（= 孔深，自动同步）" : ""}</span>
          <NumberField
            value={layer.bottomDepth}
            disabled={locked || isLast}
            onCommit={(v) => {
              if (v !== null) patch({ bottomDepth: v });
            }}
          />
        </label>
        <label>
          <span>岩性名称</span>
          <input value={layer.soilName} disabled={locked} placeholder="如：粉质黏土" onChange={(e) => patch({ soilName: e.target.value })} />
        </label>
        <label>
          <span>密实度 / 状态</span>
          <select value={layer.density} disabled={locked} onChange={(e) => patch({ density: e.target.value })}>
            <option value="">请选择</option>
            {DENSITY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>土色</span>
          <input value={layer.color} disabled={locked} placeholder="如：黄褐" onChange={(e) => patch({ color: e.target.value })} />
        </label>
        <label className={casingMissing ? "field-error" : ""}>
          <span>护壁方式{needCasing ? "（水位以下松散砂，必填）" : ""}</span>
          <select value={layer.casingMethod} disabled={locked} onChange={(e) => patch({ casingMethod: e.target.value })}>
            <option value="">未记录</option>
            {CASING_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {casingMissing && <small className="warn-text">地下水位 {fmtDepth(waterDepth as number)}m 以下的松散砂层，必须记录护壁方式后方可冻结</small>}
        </label>
        <label className="wide">
          <span>岩性描述</span>
          <input value={layer.description} disabled={locked} placeholder="包含物、状态、钻进情况等" onChange={(e) => patch({ description: e.target.value })} />
        </label>
      </div>
    </article>
  );
}

function needCasingBadge(need: boolean, missing: boolean) {
  if (!need) return null;
  return <em className={missing ? "badge badge-warn" : "badge badge-ok"}>水位以下松散砂{missing ? " · 缺护壁" : " · 已护壁"}</em>;
}

function LayersPanel({ hole, locked, update }: { hole: Borehole; locked: boolean; update: Update }) {
  const problems = validateLayers(hole.layers, hole.depth);
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>规则 1</p>
          <h2>地层分层（{hole.layers.length} 层）</h2>
        </div>
        <span className="hint">层顶自动等于上层层底，末层层底恒等于孔深，结构上保证自孔口连续至孔底</span>
      </div>
      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="layer-list">
        {hole.layers.map((layer, i) => (
          <LayerCard
            key={layer.id}
            layer={layer}
            index={i}
            isLast={i === hole.layers.length - 1}
            onlyOne={hole.layers.length <= 1}
            locked={locked}
            waterDepth={hole.waterDepth}
            update={update}
            onInsertBelow={() =>
              update((h) => {
                const target = h.layers[i];
                const mid = Math.round(((target.topDepth + target.bottomDepth) / 2) * 100) / 100;
                const first = { ...target, bottomDepth: mid };
                const second: SoilLayer = { ...target, id: uid(), topDepth: mid, bottomDepth: target.bottomDepth };
                const layers = [...h.layers.slice(0, i), first, second, ...h.layers.slice(i + 1)];
                return { ...h, layers: syncLayerTops(layers, h.depth) };
              })
            }
            onRemove={() =>
              update((h) => {
                if (h.layers.length <= 1) return h;
                return { ...h, layers: syncLayerTops(h.layers.filter((_, idx) => idx !== i), h.depth) };
              })
            }
          />
        ))}
      </div>
    </section>
  );
}

/* ---------------- 标贯 ---------------- */

function SptPanel({ hole, locked, update }: { hole: Borehole; locked: boolean; update: Update }) {
  const [top, setTop] = useState<number | null>(null);
  const [blows, setBlows] = useState<number | null>(null);
  const touched = top !== null || blows !== null;
  const problems = touched ? validateSpt(top ?? NaN, blows ?? NaN, hole.layers, hole.depth) : [];
  const host = top !== null ? sptHostLayer(hole.layers, top) : null;
  const hostIdx = host ? hole.layers.indexOf(host) + 1 : 0;
  const sorted = [...hole.spts].sort((a, b) => a.topDepth - b.topDepth);

  const submit = () => {
    if (top === null || blows === null || problems.length > 0) return;
    update((h) => {
      // 双保险：提交前再次校验，跨越分层一律拒绝
      if (validateSpt(top, blows, h.layers, h.depth).length > 0) return h;
      return { ...h, spts: [...h.spts, { id: uid(), topDepth: top, blows }] };
    });
    setTop(null);
    setBlows(null);
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>规则 2</p>
          <h2>标准贯入试验（{hole.spts.length} 次）</h2>
        </div>
        <span className="hint">试验段长度 {SPT_SEGMENT_LEN}m，必须完整落在单一土层内</span>
      </div>

      {!locked && (
        <div className="spt-form">
          <label>
            <span>试验段顶深 m</span>
            <NumberField value={top} placeholder="如 4.8" onCommit={(v) => setTop(v)} />
          </label>
          <label>
            <span>标贯击数 N</span>
            <NumberField value={blows} placeholder="整数击数" onCommit={(v) => setBlows(v)} />
          </label>
          <div className="spt-form-side">
            <span className="hint">
              {top !== null
                ? host
                  ? `所属层：第${hostIdx}层 ${host.soilName || "（未命名）"}`
                  : "所属层：—（未落入单一土层）"
                : `试验段 = 顶深起 ${SPT_SEGMENT_LEN}m`}
            </span>
            <button
              className="primary-action"
              disabled={top === null || blows === null || problems.length > 0}
              title={problems.length > 0 ? "存在校验问题，已阻止提交" : "提交标贯记录"}
              onClick={submit}
            >
              提交标贯
            </button>
          </div>
          {problems.length > 0 && (
            <ul className="problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="spt-list">
        {sorted.length === 0 && <p className="hint">暂无标贯记录。</p>}
        {sorted.map((s) => {
          const rowProblems = validateSpt(s.topDepth, s.blows, hole.layers, hole.depth);
          const rowHost = sptHostLayer(hole.layers, s.topDepth);
          const rowHostIdx = rowHost ? hole.layers.indexOf(rowHost) + 1 : 0;
          return (
            <article key={s.id} className={rowProblems.length > 0 ? "spt-row spt-invalid" : "spt-row"}>
              <strong>
                试验段 {fmtDepth(s.topDepth)}–{fmtDepth(s.topDepth + SPT_SEGMENT_LEN)}m
              </strong>
              <span>{rowHost ? `第${rowHostIdx}层 ${rowHost.soilName || "（未命名）"}` : "未落入单一土层"}</span>
              <span>N = {s.blows} 击</span>
              {!locked && (
                <button onClick={() => update((h) => ({ ...h, spts: h.spts.filter((x) => x.id !== s.id) }))}>删除</button>
              )}
              {rowProblems.length > 0 && (
                <ul className="problems">
                  {rowProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- 修订链 ---------------- */

function SnapshotView({ snapshot }: { snapshot: BoreholeSnapshot }) {
  return (
    <div className="snapshot">
      <p className="hint">
        旧值：孔深 {fmtDepth(snapshot.depth)}m · 地下水位 {snapshot.waterDepth === null ? "未揭露" : `${fmtDepth(snapshot.waterDepth)}m`} ·{" "}
        {snapshot.layers.length} 个分层 · {snapshot.spts.length} 次标贯
      </p>
      <table>
        <thead>
          <tr>
            <th>层号</th>
            <th>深度区间 m</th>
            <th>岩性</th>
            <th>状态</th>
            <th>护壁方式</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.layers.map((l, i) => (
            <tr key={l.id}>
              <td>{i + 1}</td>
              <td>
                {fmtDepth(l.topDepth)}–{fmtDepth(l.bottomDepth)}
              </td>
              <td>{l.soilName || "（未命名）"}</td>
              <td>{l.density || "—"}</td>
              <td>{l.casingMethod || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {snapshot.spts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>试验段 m</th>
              <th>标贯击数 N</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.spts.map((s) => (
              <tr key={s.id}>
                <td>
                  {fmtDepth(s.topDepth)}–{fmtDepth(s.topDepth + SPT_SEGMENT_LEN)}
                </td>
                <td>{s.blows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RevisionChain({ hole }: { hole: Borehole }) {
  const revs = [...hole.revisions].sort((a, b) => b.revNo - a.revNo);
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>留痕</p>
          <h2>修订链（{hole.revisions.length}）</h2>
        </div>
      </div>
      {revs.length === 0 && <p className="hint">暂无修订记录；钻孔冻结后，每次修改都须在此留下带原因的修订。</p>}
      {revs.map((rev) => (
        <article key={rev.id} className="revision-item">
          <header>
            <strong>修订 #{rev.revNo}</strong>
            <span className="hint">{fmtTime(rev.createdAt)}</span>
          </header>
          <p className="revision-reason">原因：{rev.reason}</p>
          <details>
            <summary>查看修订前旧值</summary>
            <SnapshotView snapshot={rev.snapshot} />
          </details>
        </article>
      ))}
    </section>
  );
}

/* ---------------- 钻孔编辑器 ---------------- */

function HoleEditor({ hole, update, onDelete }: { hole: Borehole; update: Update; onDelete: () => void }) {
  const locked = hole.status === "frozen";
  return (
    <div className="editor">
      <BasicPanel hole={hole} locked={locked} update={update} onDelete={onDelete} />
      <FreezePanel hole={hole} update={update} />
      <LayersPanel hole={hole} locked={locked} update={update} />
      <SptPanel hole={hole} locked={locked} update={update} />
      <RevisionChain hole={hole} />
    </div>
  );
}

/* ---------------- 应用 ---------------- */

function App() {
  const [holes, setHoles] = useState<Borehole[]>(loadHoles);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  // 任何变更即时落盘，刷新后分层、试验与修订链保持一致
  useEffect(() => {
    saveHoles(holes);
  }, [holes]);

  const selected = holes.find((h) => h.id === selectedId) ?? holes[0] ?? null;
  const updateHole = (id: string, fn: (h: Borehole) => Borehole) =>
    setHoles((hs) => hs.map((h) => (h.id === id ? fn(h) : h)));

  const filtered = filter ? holes.filter((h) => h.layers.some((l) => l.soilName.includes(filter))) : holes;

  const totalDepth = holes.reduce((s, h) => s + h.depth, 0);
  const totalLayers = holes.reduce((s, h) => s + h.layers.length, 0);
  const allBlows = holes.flatMap((h) => h.spts.map((s) => s.blows));
  const maxBlows = allBlows.length > 0 ? Math.max(...allBlows) : null;
  const waters = holes.filter((h) => h.waterDepth !== null).map((h) => h.waterDepth as number);
  const minWater = waters.length > 0 ? Math.min(...waters) : null;

  const addHole = () => {
    const depth = 10;
    const nums = holes
      .map((h) => /^ZK-(\d+)$/.exec(h.code)?.[1])
      .filter((x): x is string => Boolean(x))
      .map(Number);
    const code = `ZK-${(nums.length > 0 ? Math.max(...nums) : 0) + 1}`;
    const hole: Borehole = {
      id: uid(),
      code,
      depth,
      waterDepth: null,
      layers: syncLayerTops(
        [{ id: uid(), topDepth: 0, bottomDepth: depth, soilName: "", density: "", color: "", description: "", casingMethod: "" }],
        depth
      ),
      spts: [],
      status: "draft",
      revisions: [],
      createdAt: new Date().toISOString(),
      frozenAt: null,
    };
    setHoles((hs) => [...hs, hole]);
    setSelectedId(hole.id);
  };

  const deleteHole = (id: string) => {
    const hole = holes.find((h) => h.id === id);
    if (!hole || hole.status === "frozen" || hole.revisions.length > 0) return;
    if (!window.confirm(`确定删除钻孔 ${hole.code} 吗？仅未进入修订链的草稿可删除，此操作不可恢复。`)) return;
    setHoles((hs) => hs.filter((h) => h.id !== id));
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(holes, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `钻孔编录-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetAll = () => {
    if (!window.confirm("将清空当前全部钻孔数据并恢复示例数据，确定继续吗？")) return;
    const seeded = resetHoles();
    setHoles(seeded);
    setSelectedId(seeded[0]?.id ?? null);
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {project.id} · port {project.port}
          </p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>{project.stack}</strong>
          <span>数据落盘：浏览器 localStorage，刷新后分层、标贯与修订链保持一致</span>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="累计孔深" value={`${totalDepth.toFixed(1)}m`} index={0} />
        <MetricCard label="地层数量" value={`${totalLayers}层`} index={1} />
        <MetricCard label="最高标贯" value={maxBlows === null ? "—" : `${maxBlows}击`} index={2} />
        <MetricCard label="最浅地下水位" value={minWater === null ? "未揭露" : `${fmtDepth(minWater)}m`} index={3} />
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>角色</h2>
          <div className="chips">
            {project.users.map((user) => (
              <span key={user}>{user}</span>
            ))}
          </div>
          <h2>岩性筛选</h2>
          <div className="chips muted">
            <button className={filter === null ? "filter-active" : ""} onClick={() => setFilter(null)}>
              全部
            </button>
            {project.lithologyFilters.map((f) => (
              <button key={f} className={filter === f ? "filter-active" : ""} onClick={() => setFilter(filter === f ? null : f)}>
                {f}
              </button>
            ))}
          </div>
          <h2>钻孔列表（{filtered.length}）</h2>
          <div className="hole-list">
            {filtered.map((h) => (
              <button
                key={h.id}
                className={selected?.id === h.id ? "hole-item active" : "hole-item"}
                onClick={() => setSelectedId(h.id)}
              >
                <span className="hole-item-head">
                  <strong>{h.code}</strong>
                  <StatusChip hole={h} />
                </span>
                <span>
                  孔深 {fmtDepth(h.depth)}m · {h.layers.length} 层 · {h.spts.length} 次标贯
                  {h.waterDepth !== null ? ` · 水位 ${fmtDepth(h.waterDepth)}m` : " · 未见水"}
                </span>
              </button>
            ))}
            {filtered.length === 0 && <p className="hint">当前筛选下没有钻孔。</p>}
          </div>
          <div className="sidebar-actions">
            <button className="primary-action" onClick={addHole}>
              新增钻孔
            </button>
            <button onClick={exportJson}>导出 JSON</button>
            <button onClick={resetAll}>恢复示例数据</button>
          </div>
        </aside>

        {selected ? (
          <HoleEditor key={selected.id} hole={selected} update={(fn) => updateHole(selected.id, fn)} onDelete={() => deleteHole(selected.id)} />
        ) : (
          <section className="panel">
            <p className="hint">暂无钻孔，请点击左侧“新增钻孔”开始编录。</p>
          </section>
        )}
      </section>
    </main>
  );
}

export default App;
