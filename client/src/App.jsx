import React, { useState } from 'react';
import BoardDiagram, { partColor } from './BoardDiagram.jsx';

const SAMPLE = {
  boardWidth: 2440,
  boardHeight: 1220,
  kerf: 3,
  parts: [
    { name: '柜门', width: 600, height: 400, quantity: 4 },
    { name: '侧板', width: 800, height: 350, quantity: 3 },
    { name: '抽屉面', width: 500, height: 200, quantity: 6 },
    { name: '背板条', width: 1000, height: 120, quantity: 2 },
  ],
};

const EMPTY_PART = { name: '', width: '', height: '', quantity: 1 };

export default function App() {
  const [boardWidth, setBoardWidth] = useState(String(SAMPLE.boardWidth));
  const [boardHeight, setBoardHeight] = useState(String(SAMPLE.boardHeight));
  const [kerf, setKerf] = useState(String(SAMPLE.kerf));
  const [parts, setParts] = useState(SAMPLE.parts.map((p) => ({ ...p })));
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const updatePart = (i, key, value) => {
    setParts((prev) => prev.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));
  };
  const addPart = () => setParts((prev) => [...prev, { ...EMPTY_PART }]);
  const removePart = (i) => setParts((prev) => prev.filter((_, idx) => idx !== i));
  const loadSample = () => {
    setBoardWidth(String(SAMPLE.boardWidth));
    setBoardHeight(String(SAMPLE.boardHeight));
    setKerf(String(SAMPLE.kerf));
    setParts(SAMPLE.parts.map((p) => ({ ...p })));
    setResult(null);
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/cut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardWidth: Number(boardWidth),
          boardHeight: Number(boardHeight),
          kerf: kerf === '' ? 0 : Number(kerf),
          parts: parts.map((p) => ({
            name: p.name,
            width: Number(p.width),
            height: Number(p.height),
            quantity: Number(p.quantity),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || '计算失败，请检查输入');
      } else {
        setResult(data.result);
      }
    } catch (err) {
      setError('无法连接排料服务，请确认后端已启动');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <header className="site-header">
        <h1>矩形板材下料 · 断头切割排料</h1>
        <p>输入原板、锯缝与零件清单，按固定排序的断头切割规则生成逐板裁切方案</p>
      </header>

      <main className="layout">
        <section className="panel form-panel">
          <form onSubmit={submit}>
            <h2>原板参数</h2>
            <div className="grid-3">
              <label>
                原板长度
                <input type="number" step="any" min="0" value={boardWidth}
                  onChange={(e) => setBoardWidth(e.target.value)} required />
              </label>
              <label>
                原板宽度
                <input type="number" step="any" min="0" value={boardHeight}
                  onChange={(e) => setBoardHeight(e.target.value)} required />
              </label>
              <label>
                锯缝宽度
                <input type="number" step="any" min="0" value={kerf}
                  onChange={(e) => setKerf(e.target.value)} />
              </label>
            </div>
            <p className="hint">长度 / 宽度单位保持一致即可（通常为 mm）；锯缝宽度为 0 时表示理想无锯口切割。</p>

            <div className="parts-head">
              <h2>零件清单</h2>
              <button type="button" className="btn ghost" onClick={loadSample}>载入示例</button>
            </div>
            <p className="hint">零件严格按下表顺序依次排料（不做大小重排）；每件零件允许旋转 90°，余量相同时优先不旋转。</p>

            <div className="parts-list">
              <div className="part-row part-row-head">
                <span>名称</span>
                <span>长度</span>
                <span>宽度</span>
                <span>数量</span>
                <span className="op-col"></span>
              </div>
              {parts.map((p, i) => (
                <div className="part-row" key={i}>
                  <input value={p.name} placeholder={`零件${i + 1}`}
                    onChange={(e) => updatePart(i, 'name', e.target.value)} />
                  <input type="number" step="any" min="0" value={p.width} required
                    onChange={(e) => updatePart(i, 'width', e.target.value)} />
                  <input type="number" step="any" min="0" value={p.height} required
                    onChange={(e) => updatePart(i, 'height', e.target.value)} />
                  <input type="number" step="1" min="1" value={p.quantity} required
                    onChange={(e) => updatePart(i, 'quantity', e.target.value)} />
                  <button type="button" className="btn icon op-col" title="删除该零件"
                    onClick={() => removePart(i)} disabled={parts.length <= 1}>✕</button>
                </div>
              ))}
            </div>
            <button type="button" className="btn ghost wide" onClick={addPart}>＋ 添加零件</button>

            <button type="submit" className="btn primary wide" disabled={loading}>
              {loading ? '正在排料…' : '生成裁切方案'}
            </button>
          </form>
        </section>

        <section className="panel result-panel">
          {error && (
            <div className="alert" role="alert">
              <strong>无法排料：</strong>{error}
            </div>
          )}

          {!result && !error && (
            <div className="empty">
              <p>填写左侧参数后点击「生成裁切方案」。</p>
              <ul>
                <li>每刀贯穿当前矩形区域，锯缝从余料一侧扣除并计入面积</li>
                <li>图中标出零件、余料以及①②③…切割次序</li>
                <li>输出用板数、余料面积、锯缝面积与利用率</li>
              </ul>
            </div>
          )}

          {result && (
            <>
              <h2>排料结果</h2>
              <div className="stat-grid">
                <div className="stat"><b>{result.boardsCount}</b><span>用板数</span></div>
                <div className="stat"><b>{fmt(result.totalParts)}</b><span>零件总数</span></div>
                <div className="stat"><b>{fmt(result.partsArea)}</b><span>零件总面积</span></div>
                <div className="stat"><b>{fmt(result.kerfArea)}</b><span>锯缝损耗面积</span></div>
                <div className="stat accent"><b>{fmt(result.remainderArea)}</b><span>余料总面积</span></div>
                <div className="stat"><b>{result.utilization}%</b><span>总利用率</span></div>
              </div>
              <p className="hint">
                原板 {strip(result.boardWidth)} × {strip(result.boardHeight)}，
                单张面积 {fmt(result.totalArea / result.boardsCount)}；
                余料面积 = 原板总面积 − 零件面积 − 锯缝损耗。
              </p>

              <div className="legend">
                <span><i className="sw remainder" />余料</span>
                <span><i className="sw kerf" />锯缝（虚线为刀刃，数字为下刀次序）</span>
                {uniqueNames(result).map((n) => (
                  <span key={n}><i className="sw" style={{ background: partColor(n) }} />{n}</span>
                ))}
              </div>

              {result.boards.map((b) => (
                <div className="board-card" key={b.index}>
                  <h3>第 {b.index} 张板 / 共 {result.boardsCount} 张</h3>
                  <BoardDiagram board={b} boardWidth={result.boardWidth} boardHeight={result.boardHeight} />
                  <div className="board-stats">
                    <span>零件 {fmt(b.partsArea)}</span>
                    <span>锯缝 {fmt(b.kerfArea)}</span>
                    <span>余料 {fmt(b.remainderArea)}</span>
                    <span>利用率 {b.utilization}%</span>
                    <span>{b.cuts.length} 刀</span>
                  </div>
                  <details>
                    <summary>查看零件落位与切割次序明细</summary>
                    <table className="detail-table">
                      <thead>
                        <tr><th>零件</th><th>件号</th><th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th></tr>
                      </thead>
                      <tbody>
                        {b.placements.map((p, i) => (
                          <tr key={i}>
                            <td>{p.part}</td>
                            <td>#{p.index}</td>
                            <td>{strip(p.x)}, {strip(p.y)}</td>
                            <td>{strip(p.w)} × {strip(p.h)}</td>
                            <td>{p.rotated ? '是' : '否'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <table className="detail-table">
                      <thead>
                        <tr><th>刀序</th><th>方向</th><th>起点 x1,y1</th><th>终点 x2,y2</th><th>贯穿长度</th></tr>
                      </thead>
                      <tbody>
                        {b.cuts.map((c) => (
                          <tr key={c.seq}>
                            <td>{c.seq}</td>
                            <td>{c.type === 'v' ? '竖切' : '横切'}</td>
                            <td>{strip(c.x1)}, {strip(c.y1)}</td>
                            <td>{strip(c.x2)}, {strip(c.y2)}</td>
                            <td>{strip(c.length)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </div>
              ))}
            </>
          )}
        </section>
      </main>

      <footer className="site-footer">
        断头切割规则：每一刀都贯穿当前所在矩形区域 · 允许零件旋转 90° · 按输入固定顺序排料
      </footer>
    </div>
  );
}

function uniqueNames(result) {
  const set = new Set();
  result.boards.forEach((b) => b.placements.forEach((p) => set.add(p.part)));
  return [...set];
}

function fmt(n) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
function strip(n) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}
