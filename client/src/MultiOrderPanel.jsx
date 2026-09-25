import React, { useState } from 'react';
import BoardDiagram, { partColor } from './BoardDiagram.jsx';

const SAMPLE = {
  boardWidth: 2440,
  boardHeight: 1220,
  kerf: 3,
  boardPrice: 128.5,
  orders: [
    {
      orderId: 'A001',
      parts: [
        { name: '柜门', width: 600, height: 400, quantity: 3 },
        { name: '抽屉面', width: 500, height: 200, quantity: 2 },
      ],
    },
    {
      orderId: 'A002',
      parts: [
        { name: '柜门', width: 550, height: 380, quantity: 2 }, // 与 A001 同名零件
        { name: '层板', width: 700, height: 300, quantity: 3 },
      ],
    },
  ],
};

const emptyPart = () => ({ name: '', width: '', height: '', quantity: 1 });
const emptyOrder = (n) => ({ orderId: `A${String(n).padStart(3, '0')}`, parts: [emptyPart()] });

export default function MultiOrderPanel() {
  const [boardWidth, setBoardWidth] = useState(String(SAMPLE.boardWidth));
  const [boardHeight, setBoardHeight] = useState(String(SAMPLE.boardHeight));
  const [kerf, setKerf] = useState(String(SAMPLE.kerf));
  const [boardPrice, setBoardPrice] = useState(String(SAMPLE.boardPrice));
  const [orders, setOrders] = useState(
    SAMPLE.orders.map((o) => ({ orderId: o.orderId, parts: o.parts.map((p) => ({ ...p })) }))
  );
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const updateOrderId = (oi, value) => {
    setOrders((prev) => prev.map((o, i) => (i === oi ? { ...o, orderId: value } : o)));
  };
  const addOrder = () => setOrders((prev) => [...prev, emptyOrder(prev.length + 1)]);
  const removeOrder = (oi) => setOrders((prev) => prev.filter((_, i) => i !== oi));
  const updatePart = (oi, pi, key, value) => {
    setOrders((prev) => prev.map((o, i) => (i === oi
      ? { ...o, parts: o.parts.map((p, j) => (j === pi ? { ...p, [key]: value } : p)) }
      : o)));
  };
  const addPart = (oi) => {
    setOrders((prev) => prev.map((o, i) => (i === oi ? { ...o, parts: [...o.parts, emptyPart()] } : o)));
  };
  const removePart = (oi, pi) => {
    setOrders((prev) => prev.map((o, i) => (i === oi
      ? { ...o, parts: o.parts.filter((_, j) => j !== pi) }
      : o)));
  };
  const loadSample = () => {
    setBoardWidth(String(SAMPLE.boardWidth));
    setBoardHeight(String(SAMPLE.boardHeight));
    setKerf(String(SAMPLE.kerf));
    setBoardPrice(String(SAMPLE.boardPrice));
    setOrders(SAMPLE.orders.map((o) => ({ orderId: o.orderId, parts: o.parts.map((p) => ({ ...p })) })));
    setResult(null);
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/cut-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardWidth: Number(boardWidth),
          boardHeight: Number(boardHeight),
          kerf: kerf === '' ? 0 : Number(kerf),
          boardPrice: boardPrice === '' ? 0 : Number(boardPrice),
          orders: orders.map((o) => ({
            orderId: o.orderId,
            parts: o.parts.map((p) => ({
              name: p.name,
              width: Number(p.width),
              height: Number(p.height),
              quantity: Number(p.quantity),
            })),
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
          <div className="grid-3 price-row">
            <label>
              每张原板材料价（元）
              <input type="number" step="0.01" min="0" value={boardPrice}
                onChange={(e) => setBoardPrice(e.target.value)} required />
            </label>
          </div>
          <p className="hint">材料价非负、最多两位小数；每张板的材料费按各订单在该板的零件实际面积比例分摊。</p>

          <div className="parts-head">
            <h2>订单列表</h2>
            <button type="button" className="btn ghost" onClick={loadSample}>载入示例</button>
          </div>
          <p className="hint">
            每个订单填写唯一订单号与零件清单，不同订单可使用同名零件；
            严格按订单顺序、订单内零件行顺序依次断头切割，落位保留订单归属。
          </p>

          {orders.map((o, oi) => (
            <div className="order-card" key={oi}>
              <div className="order-head">
                <span className="order-tag" style={{ background: partColor(o.orderId.trim() || `订单${oi + 1}`) }}>
                  订单 {oi + 1}
                </span>
                <input value={o.orderId} placeholder="订单号（必填且唯一）"
                  onChange={(e) => updateOrderId(oi, e.target.value)} required />
                <button type="button" className="btn icon" title="删除该订单"
                  onClick={() => removeOrder(oi)} disabled={orders.length <= 1}>✕</button>
              </div>
              <div className="parts-list">
                <div className="part-row part-row-head">
                  <span>名称</span>
                  <span>长度</span>
                  <span>宽度</span>
                  <span>数量</span>
                  <span className="op-col"></span>
                </div>
                {o.parts.map((p, pi) => (
                  <div className="part-row" key={pi}>
                    <input value={p.name} placeholder={`零件${pi + 1}`}
                      onChange={(e) => updatePart(oi, pi, 'name', e.target.value)} />
                    <input type="number" step="any" min="0" value={p.width} required
                      onChange={(e) => updatePart(oi, pi, 'width', e.target.value)} />
                    <input type="number" step="any" min="0" value={p.height} required
                      onChange={(e) => updatePart(oi, pi, 'height', e.target.value)} />
                    <input type="number" step="1" min="1" value={p.quantity} required
                      onChange={(e) => updatePart(oi, pi, 'quantity', e.target.value)} />
                    <button type="button" className="btn icon op-col" title="删除该零件"
                      onClick={() => removePart(oi, pi)} disabled={o.parts.length <= 1}>✕</button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn ghost wide" onClick={() => addPart(oi)}>＋ 添加零件</button>
            </div>
          ))}
          <button type="button" className="btn ghost wide" onClick={addOrder}>＋ 添加订单</button>

          <button type="submit" className="btn primary wide" disabled={loading}>
            {loading ? '正在拼版…' : '生成拼版方案'}
          </button>
        </form>
      </section>

      <section className="panel result-panel">
        {error && (
          <div className="alert" role="alert">
            <strong>无法拼版：</strong>{error}
          </div>
        )}

        {!result && !error && (
          <div className="empty">
            <p>填写左侧原板参数、材料价与各订单零件清单后，点击「生成拼版方案」。</p>
            <ul>
              <li>多个订单拼在同一批原板上，按订单顺序依次断头切割</li>
              <li>结果按订单列出跨板零件的件号、所在板号与坐标，供分单取件</li>
              <li>每张板材料费按各订单零件实际面积比例分摊（最大余数法处理尾差）</li>
              <li>逐板裁切图按订单着色，刀序与单订单模式一致</li>
            </ul>
          </div>
        )}

        {result && (
          <>
            <h2>拼版结果</h2>
            <div className="stat-grid">
              <div className="stat"><b>{result.boardsCount}</b><span>用板数</span></div>
              <div className="stat"><b>{result.ordersCount}</b><span>订单数</span></div>
              <div className="stat"><b>{fmt(result.totalParts)}</b><span>零件总数</span></div>
              <div className="stat accent"><b>{yuan(result.totalCostCents)}</b><span>材料费合计</span></div>
              <div className="stat"><b>{fmt(result.remainderArea)}</b><span>余料总面积</span></div>
              <div className="stat"><b>{result.utilization}%</b><span>总利用率</span></div>
            </div>
            <p className="hint">
              原板 {strip(result.boardWidth)} × {strip(result.boardHeight)}，
              每张材料价 {yuan(result.boardPriceCents)}；
              材料费合计 = 用板数 × 每张材料价 = 各订单分摊之和。
            </p>

            <h2>分单取件</h2>
            <p className="hint">按订单列出全部零件（含跨板）的件号、所在板号与坐标，按板号取件即可分单。</p>
            {result.orders.map((o) => (
              <div className="order-result" key={o.orderId}>
                <h3>
                  <i className="sw" style={{ background: partColor(o.orderId) }} />
                  订单 {o.orderId}
                  <span className="order-result-meta">
                    {o.partsCount} 件 · 零件面积 {fmt(o.partsArea)} · 分摊材料费 {yuan(o.costCents)}
                  </span>
                </h3>
                <table className="detail-table">
                  <thead>
                    <tr><th>零件</th><th>件号</th><th>所在板</th><th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th></tr>
                  </thead>
                  <tbody>
                    {o.items.map((it, i) => (
                      <tr key={i}>
                        <td>{it.part}</td>
                        <td>#{it.index}</td>
                        <td>第 {it.board} 板</td>
                        <td>{strip(it.x)}, {strip(it.y)}</td>
                        <td>{strip(it.w)} × {strip(it.h)}</td>
                        <td>{it.rotated ? '是' : '否'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p className="hint">
              各订单分摊合计：{result.orders.map((o) => `${o.orderId} ${yuan(o.costCents)}`).join(' ＋ ')}
              ＝ {yuan(result.totalCostCents)}
            </p>

            <h2>逐板裁切图</h2>
            <div className="legend">
              <span><i className="sw remainder" />余料</span>
              <span><i className="sw kerf" />锯缝（虚线为刀刃，数字为下刀次序）</span>
              {result.orders.map((o) => (
                <span key={o.orderId}><i className="sw" style={{ background: partColor(o.orderId) }} />{o.orderId}</span>
              ))}
            </div>

            {result.boards.map((b) => (
              <div className="board-card" key={b.index}>
                <h3>第 {b.index} 张板 / 共 {result.boardsCount} 张</h3>
                <BoardDiagram
                  board={b}
                  boardWidth={result.boardWidth}
                  boardHeight={result.boardHeight}
                  colorFor={(p) => partColor(p.order)}
                  labelFor={(p) => `${p.order}·${p.part}`}
                />
                <div className="board-stats">
                  <span>零件 {fmt(b.partsArea)}</span>
                  <span>锯缝 {fmt(b.kerfArea)}</span>
                  <span>余料 {fmt(b.remainderArea)}</span>
                  <span>利用率 {b.utilization}%</span>
                  <span>{b.cuts.length} 刀</span>
                </div>
                <table className="detail-table">
                  <thead>
                    <tr><th>订单</th><th>该板零件面积</th><th>分摊材料费</th></tr>
                  </thead>
                  <tbody>
                    {b.costShares.map((s) => (
                      <tr key={s.order}>
                        <td><i className="sw inline" style={{ background: partColor(s.order) }} />{s.order}</td>
                        <td>{fmt(s.partsArea)}</td>
                        <td>{yuan(s.amountCents)}</td>
                      </tr>
                    ))}
                    <tr className="sum-row">
                      <td>合计（板价）</td>
                      <td>{fmt(b.partsArea)}</td>
                      <td>{yuan(result.boardPriceCents)}</td>
                    </tr>
                  </tbody>
                </table>
                <details>
                  <summary>查看零件落位与切割次序明细</summary>
                  <table className="detail-table">
                    <thead>
                      <tr><th>订单</th><th>零件</th><th>件号</th><th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th></tr>
                    </thead>
                    <tbody>
                      {b.placements.map((p, i) => (
                        <tr key={i}>
                          <td>{p.order}</td>
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
  );
}

function yuan(cents) {
  return `¥${(cents / 100).toFixed(2)}`;
}
function fmt(n) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
function strip(n) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}
