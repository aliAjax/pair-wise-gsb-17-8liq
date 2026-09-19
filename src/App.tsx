import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  Borehole,
  HoleSnapshot,
  Issue,
  SoilLayer,
  SptTest,
  CASING_METHODS,
  DENSITIES,
  canFreeze,
  casingRequired,
  createRevision,
  fmt,
  freezeBlockers,
  freezeHole,
  layerIndexAt,
  layerLabel,
  loadBoreholes,
  newHole,
  newLayer,
  newTest,
  normalizeTops,
  r3,
  saveBoreholes,
  validateSpt,
} from "./lib/borehole";

const project = {
  id: "hxwl-03",
  port: 5103,
  title: "岩土钻孔编录",
  subtitle:
    "钻孔分层、标准贯入试验与地下水位的现场记录闭环：分层自孔口连续至孔底，标贯落层校验，水位以下松散砂层强制护壁，冻结后仅可带原因修订。",
  domain: "岩土工程",
};

function parseNum(raw: string): number | null {
  if (raw.trim() === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? r3(v) : null;
}

function NumInput({
  value,
  onChange,
  disabled,
  placeholder,
  min,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  min?: number;
}) {
  return (
    <input
      type="number"
      step="0.1"
      min={min}
      value={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(parseNum(e.target.value))}
    />
  );
}

function StatusBadge({ frozen }: { frozen: boolean }) {
  return <span className={frozen ? "badge badge-frozen" : "badge badge-open"}>{frozen ? "已冻结" : "编录中"}</span>;
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return <p className="ok-line">✓ 分层连续至孔底、标贯落层、护壁记录齐全，满足冻结条件。</p>;
  }
  return (
    <ul className="issue-list">
      {issues.map((issue, i) => (
        <li key={i}>{issue.message}</li>
      ))}
    </ul>
  );
}

function SnapshotView({ snapshot }: { snapshot: HoleSnapshot }) {
  return (
    <div className="snapshot">
      <p>
        孔深 {fmt(snapshot.depth)}m · 地下水位 {snapshot.waterDepth === null ? "未见" : `${fmt(snapshot.waterDepth)}m`} · 分层{" "}
        {snapshot.layers.length} 层 · 标贯 {snapshot.tests.length} 次
      </p>
      <table>
        <thead>
          <tr>
            <th>层</th>
            <th>层顶(m)</th>
            <th>层底(m)</th>
            <th>岩性</th>
            <th>密实度</th>
            <th>护壁方式</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.layers.map((l, i) => (
            <tr key={l.id}>
              <td>{i + 1}</td>
              <td>{fmt(l.topDepth)}</td>
              <td>{fmt(l.bottomDepth)}</td>
              <td>{l.soilName}</td>
              <td>{l.density}</td>
              <td>{l.casingMethod || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {snapshot.tests.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>试验深度(m)</th>
              <th>段长(m)</th>
              <th>标贯击数</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.tests.map((t) => (
              <tr key={t.id}>
                <td>{fmt(t.depth)}</td>
                <td>{fmt(t.segmentLength)}</td>
                <td>{t.blows ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LayerTable({
  hole,
  disabled,
  onChange,
}: {
  hole: Borehole;
  disabled: boolean;
  onChange: (layers: SoilLayer[]) => void;
}) {
  const update = (id: string, patch: Partial<SoilLayer>) =>
    onChange(hole.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLayer = () => {
    const last = hole.layers[hole.layers.length - 1];
    const top = last ? last.bottomDepth : 0;
    const bottom = Math.min(hole.depth, r3(top + 1));
    onChange([...hole.layers, newLayer(top, bottom)]);
  };

  const removeLayer = (id: string) => onChange(hole.layers.filter((l) => l.id !== id));

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>{project.domain}</p>
          <h2>钻孔分层</h2>
        </div>
        {!disabled && (
          <button className="primary-action" onClick={addLayer}>
            新增分层
          </button>
        )}
      </div>
      <p className="hint">层顶自动等于上层层底；末层层底须等于孔深 {fmt(hole.depth)}m，分层不得间断或超出孔深。</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>层</th>
              <th>层顶(m)</th>
              <th>层底(m)</th>
              <th>岩性名称</th>
              <th>密实度/状态</th>
              <th>土色</th>
              <th>护壁方式</th>
              <th>水位</th>
              {!disabled && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {hole.layers.map((l, i) => {
              const needCasing = casingRequired(hole, l);
              const missingCasing = needCasing && !l.casingMethod.trim();
              const belowWater = hole.waterDepth !== null && l.bottomDepth - hole.waterDepth > 1e-6;
              return (
                <tr key={l.id} className={missingCasing ? "row-error" : undefined}>
                  <td>{i + 1}</td>
                  <td className="mono">{fmt(l.topDepth)}</td>
                  <td>
                    <NumInput
                      value={l.bottomDepth}
                      disabled={disabled}
                      min={0}
                      onChange={(v) => update(l.id, { bottomDepth: v ?? l.bottomDepth })}
                    />
                  </td>
                  <td>
                    <input
                      value={l.soilName}
                      disabled={disabled}
                      placeholder="如：粉砂"
                      onChange={(e) => update(l.id, { soilName: e.target.value })}
                    />
                  </td>
                  <td>
                    <select value={l.density} disabled={disabled} onChange={(e) => update(l.id, { density: e.target.value })}>
                      {DENSITIES.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={l.color}
                      disabled={disabled}
                      placeholder="如：灰黄"
                      onChange={(e) => update(l.id, { color: e.target.value })}
                    />
                  </td>
                  <td className={missingCasing ? "cell-error" : undefined}>
                    <select
                      value={l.casingMethod}
                      disabled={disabled}
                      onChange={(e) => update(l.id, { casingMethod: e.target.value })}
                    >
                      <option value="">{needCasing ? "⚠ 必选（水位以下松散砂）" : "—"}</option>
                      {CASING_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{belowWater ? <span className="tag tag-water">水位以下</span> : <span className="tag">水位以上</span>}</td>
                  {!disabled && (
                    <td>
                      <button className="link-danger" onClick={() => removeLayer(l.id)} disabled={hole.layers.length <= 1}>
                        删除
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SptTable({
  hole,
  disabled,
  onChange,
}: {
  hole: Borehole;
  disabled: boolean;
  onChange: (tests: SptTest[]) => void;
}) {
  const update = (id: string, patch: Partial<SptTest>) =>
    onChange(hole.tests.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>标准贯入试验</p>
          <h2>标贯记录</h2>
        </div>
        {!disabled && (
          <button className="primary-action" onClick={() => onChange([...hole.tests, newTest()])}>
            新增标贯
          </button>
        )}
      </div>
      <p className="hint">试验段（默认 0.45m）必须完整落在同一土层内；跨越分层时将阻止提交并列出相邻层。</p>
      {hole.tests.length === 0 ? (
        <p className="empty">暂无标贯记录。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>试验深度(m)</th>
                <th>段长(m)</th>
                <th>标贯击数</th>
                <th>所属土层</th>
                <th>落层校验</th>
                {!disabled && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {hole.tests.map((t) => {
                const issues = validateSpt(hole, t);
                const idx = layerIndexAt(hole.layers, t.depth);
                return (
                  <tr key={t.id} className={issues.length ? "row-error" : undefined}>
                    <td>
                      <NumInput
                        value={t.depth}
                        disabled={disabled}
                        min={0}
                        onChange={(v) => update(t.id, { depth: v ?? t.depth })}
                      />
                    </td>
                    <td>
                      <NumInput
                        value={t.segmentLength}
                        disabled={disabled}
                        min={0}
                        onChange={(v) => update(t.id, { segmentLength: v ?? t.segmentLength })}
                      />
                    </td>
                    <td>
                      <NumInput
                        value={t.blows}
                        disabled={disabled}
                        min={0}
                        placeholder="击数"
                        onChange={(v) => update(t.id, { blows: v === null ? null : Math.round(v) })}
                      />
                    </td>
                    <td>{idx >= 0 ? layerLabel(hole.layers, idx) : "—"}</td>
                    <td className="cell-issues">
                      {issues.length === 0 ? (
                        <span className="tag tag-ok">层内 ✓</span>
                      ) : (
                        <ul>
                          {issues.map((issue, i) => (
                            <li key={i}>{issue.message}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    {!disabled && (
                      <td>
                        <button className="link-danger" onClick={() => onChange(hole.tests.filter((x) => x.id !== t.id))}>
                          删除
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RevisionChain({ hole }: { hole: Borehole }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>审计追溯</p>
          <h2>修订链（{hole.revisions.length}）</h2>
        </div>
      </div>
      {hole.revisions.length === 0 ? (
        <p className="empty">暂无修订。钻孔冻结后，任何修改都须先新建带原因的修订，旧值将保留在此处。</p>
      ) : (
        <div className="record-list">
          {[...hole.revisions].reverse().map((rev, i) => (
            <article key={rev.id} className="record-card">
              <div className="record-index">R{hole.revisions.length - i}</div>
              <div>
                <h3>{rev.reason}</h3>
                <p>{new Date(rev.createdAt).toLocaleString("zh-CN")} · 修订前快照已保留</p>
                <details>
                  <summary>查看修订前旧值</summary>
                  <SnapshotView snapshot={rev.snapshot} />
                </details>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function HoleDetail({
  hole,
  onUpdate,
  onRemove,
}: {
  hole: Borehole;
  onUpdate: (next: Borehole) => void;
  onRemove: () => void;
}) {
  const [reason, setReason] = useState("");
  const [revising, setRevising] = useState(false);
  const [reasonError, setReasonError] = useState("");

  const issues = useMemo(() => freezeBlockers(hole), [hole]);
  const freezable = canFreeze(hole);

  const patch = (p: Partial<Borehole>) => onUpdate({ ...hole, ...p });

  const submitRevision = () => {
    if (!reason.trim()) {
      setReasonError("修订原因不能为空。");
      return;
    }
    onUpdate(createRevision(hole, reason));
    setReason("");
    setReasonError("");
    setRevising(false);
  };

  const doFreeze = () => {
    const next = freezeHole(hole);
    if (next) onUpdate(next);
  };

  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>钻孔编录单</p>
            <h2>
              {hole.code} <StatusBadge frozen={hole.frozen} />
            </h2>
          </div>
          <div className="actions">
            {hole.frozen ? (
              <button className="primary-action" onClick={() => setRevising(true)}>
                新建修订
              </button>
            ) : (
              <button
                className="primary-action"
                onClick={doFreeze}
                disabled={!freezable}
                title={freezable ? "冻结后仅可通过修订修改" : `存在 ${issues.length} 项待解决问题`}
              >
                冻结钻孔
              </button>
            )}
            <button
              className="link-danger"
              onClick={() => {
                if (window.confirm(`确认删除钻孔 ${hole.code}？其分层、标贯与修订链将一并删除。`)) onRemove();
              }}
            >
              删除钻孔
            </button>
          </div>
        </div>

        {hole.frozen && (
          <p className="banner">已冻结：分层、标贯与水位均为只读。如需修改，请新建带原因的修订，当前值将进入修订链保留。</p>
        )}

        {revising && hole.frozen && (
          <div className="revision-form">
            <label>
              <span>修订原因（必填，旧值随修订保留）</span>
              <textarea
                rows={2}
                value={reason}
                placeholder="如：补充水位观测后更新护壁方式"
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {reasonError && <p className="error-text">{reasonError}</p>}
            <div className="actions">
              <button className="primary-action" onClick={submitRevision}>
                提交修订并解锁
              </button>
              <button onClick={() => setRevising(false)}>取消</button>
            </div>
          </div>
        )}

        <div className="field-grid">
          <label>
            <span>钻孔编号</span>
            <input value={hole.code} disabled={hole.frozen} onChange={(e) => patch({ code: e.target.value })} />
          </label>
          <label>
            <span>孔深(m)</span>
            <NumInput
              value={hole.depth}
              disabled={hole.frozen}
              min={0}
              onChange={(v) => patch({ depth: v ?? hole.depth })}
            />
          </label>
          <label>
            <span>地下水位埋深(m)，留空表示未见水</span>
            <NumInput
              value={hole.waterDepth}
              disabled={hole.frozen}
              placeholder="未见水"
              min={0}
              onChange={(v) => patch({ waterDepth: v })}
            />
          </label>
        </div>

        <div className="freeze-check">
          <h3>冻结检查</h3>
          <IssueList issues={issues} />
        </div>
      </section>

      <LayerTable hole={hole} disabled={hole.frozen} onChange={(layers) => patch({ layers: normalizeTops(layers) })} />
      <SptTable hole={hole} disabled={hole.frozen} onChange={(tests) => patch({ tests })} />
      <RevisionChain hole={hole} />
    </>
  );
}

function App() {
  const [holes, setHoles] = useState<Borehole[]>(loadBoreholes);
  const [selectedId, setSelectedId] = useState<string>(() => holes[0]?.id ?? "");

  // 任何变更即时落盘，刷新后分层、试验与修订链保持一致
  useEffect(() => {
    saveBoreholes(holes);
  }, [holes]);

  const selected = holes.find((h) => h.id === selectedId) ?? holes[0];

  const metrics = useMemo(() => {
    const totalDepth = holes.reduce((s, h) => s + h.depth, 0);
    const layerCount = holes.reduce((s, h) => s + h.layers.length, 0);
    const blows = holes.flatMap((h) => h.tests.map((t) => t.blows)).filter((b): b is number => b !== null);
    const waters = holes.map((h) => h.waterDepth).filter((w): w is number => w !== null);
    return [
      { label: "累计孔深", value: `${fmt(totalDepth)}m` },
      { label: "地层数量", value: `${layerCount}层` },
      { label: "最高标贯", value: blows.length ? `${Math.max(...blows)}击` : "—" },
      { label: "最浅地下水位", value: waters.length ? `${fmt(Math.min(...waters))}m` : "未见" },
    ];
  }, [holes]);

  const addHole = () => {
    const nums = holes.map((h) => Number(h.code.replace(/\D/g, ""))).filter((n) => Number.isFinite(n));
    const next = newHole(`ZK-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0")}`);
    setHoles((hs) => [...hs, next]);
    setSelectedId(next.id);
  };

  const updateHole = (next: Borehole) => setHoles((hs) => hs.map((h) => (h.id === next.id ? next : h)));
  const removeHole = (id: string) => {
    setHoles((hs) => {
      const rest = hs.filter((h) => h.id !== id);
      if (selectedId === id) setSelectedId(rest[0]?.id ?? "");
      return rest;
    });
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
          <span>闭环规则</span>
          <strong>
            分层连续到孔底 · 标贯不得跨层 · 水位以下松散砂必录护壁 · 冻结后仅可带原因修订
          </strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, i) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={["status-ok", "status-watch", "status-danger", "status-ok"][i % 4]} />
          </article>
        ))}
      </section>

      <div className="workspace">
        <aside className="panel narrow">
          <div className="section-heading">
            <h2>钻孔列表</h2>
            <button className="primary-action" onClick={addHole}>
              新增钻孔
            </button>
          </div>
          <div className="hole-list">
            {holes.map((h) => (
              <button
                key={h.id}
                className={h.id === selected?.id ? "hole-item active" : "hole-item"}
                onClick={() => setSelectedId(h.id)}
              >
                <strong>{h.code}</strong>
                <span>
                  {fmt(h.depth)}m · {h.layers.length}层 · 标贯{h.tests.length}次
                </span>
                <StatusBadge frozen={h.frozen} />
              </button>
            ))}
            {holes.length === 0 && <p className="empty">暂无钻孔，请点击“新增钻孔”。</p>}
          </div>
        </aside>

        <div className="detail">
          {selected ? (
            <HoleDetail key={selected.id} hole={selected} onUpdate={updateHole} onRemove={() => removeHole(selected.id)} />
          ) : (
            <section className="panel">
              <p className="empty">请选择或新增一个钻孔开始编录。</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

export default App;
