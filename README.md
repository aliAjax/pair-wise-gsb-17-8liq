# hxwl-03 岩土钻孔编录

钻孔分层、标准贯入试验与地下水位的现场记录闭环（数据经 localStorage 落盘，刷新后分层、标贯与修订链保持一致）。

## 技术栈

React + Vite + TypeScript + CSS

## 本地运行

```bash
npm install
npm run dev
```

开发端口：5103

## 闭环规则

1. **分层连续**：每孔分层从孔口 0.00m 连续到孔底，层顶深度自动等于上层层底，层底不得超出孔深，末层层底必须等于孔深。
2. **标贯落层**：标贯试验深度必须落在所属土层内；试验段（默认 0.45m）跨越分层时阻止提交，并在记录行内列出涉及的相邻层。
3. **水位护壁**：记录地下水位后，水位以下的松散砂层必须记录护壁方式（泥浆/套管/跟管等），缺失时整孔不得冻结。
4. **冻结与修订**：满足全部校验方可冻结；已冻结钻孔只读，只能新建带原因的修订解锁，修订前旧值进入修订链保留，可随时回看。

## 代码结构

- `src/lib/borehole.ts` — 领域模型、四条闭环校验规则、冻结/修订、localStorage 持久化（不依赖 React）
- `src/App.tsx` — 钻孔列表、编录单、分层表、标贯表、冻结检查、修订链 UI
- `scripts/logic-check.cjs` — 闭环规则的 Node 逻辑校验

## 逻辑校验

```bash
npx tsc src/lib/borehole.ts --outDir /tmp/bhcheck --module commonjs --target es2019 --skipLibCheck
node scripts/logic-check.cjs
```
