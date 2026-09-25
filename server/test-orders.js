/* 多订单拼版自检：订单归属与顺序、分单取件清单、材料费最大余数法分摊、输入校验 */
'use strict';
const assert = require('assert');
const { cutOrders, UserError } = require('./src/cutting');

/** 通用一致性校验：几何守恒 + 逐板分摊额 == 板价 + 订单汇总 == 总板价 */
function checkConsistency(r, priceCents) {
  assert.strictEqual(r.boardPriceCents, priceCents);
  assert.strictEqual(r.totalCostCents, r.boardsCount * priceCents, '总板价 = 用板数 × 单板价');

  let placementCount = 0;
  for (const b of r.boards) {
    const boardArea = b.width * b.height;
    assert(Math.abs(boardArea - b.partsArea - b.kerfArea - b.remainderArea) < 0.01,
      `板 ${b.index} 面积不守恒`);
    // 逐板分摊额之和恰好等于该板板价
    const shareSum = b.costShares.reduce((s, c) => s + c.amountCents, 0);
    assert.strictEqual(shareSum, priceCents, `板 ${b.index} 分摊额之和应等于板价`);
    // 分摊面积之和等于该板零件面积
    const shareArea = b.costShares.reduce((s, c) => s + c.partsArea, 0);
    assert(Math.abs(shareArea - b.partsArea) < 0.01, `板 ${b.index} 分摊面积应等于零件面积`);
    // 落位均带订单归属且不越界、不重叠
    const ps = b.placements;
    for (let i = 0; i < ps.length; i++) {
      assert.ok(ps[i].order, '落位缺少订单归属');
      assert(ps[i].x >= -1e-6 && ps[i].y >= -1e-6, '零件起点越界');
      assert(ps[i].x + ps[i].w <= b.width + 1e-6 && ps[i].y + ps[i].h <= b.height + 1e-6, '零件越界');
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        const overlap = a.x < c.x + c.w - 1e-6 && c.x < a.x + a.w - 1e-6 &&
          a.y < c.y + c.h - 1e-6 && c.y < a.y + a.h - 1e-6;
        assert(!overlap, `板 ${b.index} 零件重叠`);
      }
    }
    placementCount += ps.length;
    b.cuts.forEach((cut, i) => assert.strictEqual(cut.seq, i + 1));
  }
  assert.strictEqual(placementCount, r.totalParts, '落位总数应等于零件总数');

  // 订单汇总 == 总板价；分单取件清单与落位一一对应
  const orderCostSum = r.orders.reduce((s, o) => s + o.costCents, 0);
  assert.strictEqual(orderCostSum, r.totalCostCents, '各订单分摊汇总应等于总板价');
  const allItems = r.orders.flatMap((o) => o.items.map((it) => ({ ...it, order: o.orderId })));
  assert.strictEqual(allItems.length, r.totalParts, '分单取件清单应覆盖全部零件');
  const key = (p) => `${p.order}|${p.part}|${p.index}|${p.board ?? ''}`;
  const placementKeys = new Set();
  for (const b of r.boards) {
    for (const p of b.placements) placementKeys.add(`${p.order}|${p.part}|${p.index}|${b.index}`);
  }
  for (const it of allItems) {
    assert.ok(placementKeys.has(key(it)), `取件清单与落位不符：${key(it)}`);
    const board = r.boards[it.board - 1];
    const hit = board.placements.find((p) =>
      p.order === it.order && p.part === it.part && p.index === it.index);
    assert.strictEqual(hit.x, it.x);
    assert.strictEqual(hit.y, it.y);
  }
}

// 1) 基本多订单：同名零件跨订单、排料顺序、单板费用均分
const r1 = cutOrders({
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 100,
  orders: [
    { orderId: 'A001', parts: [{ name: '门板', width: 600, height: 400, quantity: 2 }] },
    { orderId: 'A002', parts: [{ name: '门板', width: 600, height: 400, quantity: 2 }] }, // 同名零件
  ],
});
assert.strictEqual(r1.boardsCount, 1);
assert.strictEqual(r1.ordersCount, 2);
// 排料顺序：订单 A001 的 2 件全部落位后才轮到 A002
assert.deepStrictEqual(r1.boards[0].placements.map((p) => p.order),
  ['A001', 'A001', 'A002', 'A002']);
// 面积各半 → 100 元各分 50 元
assert.strictEqual(r1.orders[0].costCents, 5000);
assert.strictEqual(r1.orders[1].costCents, 5000);
assert.strictEqual(r1.totalCostCents, 10000);
// 分单取件：件号、板号、坐标齐全
assert.deepStrictEqual(r1.orders[0].items.map((i) => [i.part, i.index, i.board]),
  [['门板', 1, 1], ['门板', 2, 1]]);
checkConsistency(r1, 10000);
console.log('1) 基本多订单通过：用板', r1.boardsCount, '张，总材料费', r1.totalCost, '元');

// 2) 最大余数法 · 同余按订单输入顺序：板价 1 分、两订单面积相等 → 先输入的订单得尾差
const r2 = cutOrders({
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 0.01,
  orders: [
    { orderId: '先', parts: [{ name: '块', width: 600, height: 400, quantity: 2 }] },
    { orderId: '后', parts: [{ name: '块', width: 600, height: 400, quantity: 2 }] },
  ],
});
assert.strictEqual(r2.orders[0].costCents, 1, '同余时按订单输入顺序分配尾差');
assert.strictEqual(r2.orders[1].costCents, 0);
checkConsistency(r2, 1);

// 3) 最大余数法 · 余数大者优先：面积 3:1、板价 1 分 → 面积大的订单得尾差
const r3 = cutOrders({
  boardWidth: 800, boardHeight: 500, kerf: 0, boardPrice: 0.01,
  orders: [
    { orderId: '小', parts: [{ name: '条', width: 200, height: 500, quantity: 1 }] },
    { orderId: '大', parts: [{ name: '条', width: 600, height: 500, quantity: 1 }] },
  ],
});
assert.strictEqual(r3.boardsCount, 1);
assert.strictEqual(r3.orders.find((o) => o.orderId === '大').costCents, 1);
assert.strictEqual(r3.orders.find((o) => o.orderId === '小').costCents, 0);
checkConsistency(r3, 1);

// 4) 面积比例精确分摊：600×500 与 400×500 同板，板价 90 元 → 54 / 36
const r4 = cutOrders({
  boardWidth: 1000, boardHeight: 500, kerf: 0, boardPrice: 90,
  orders: [
    { orderId: '甲', parts: [{ name: '大板', width: 600, height: 500, quantity: 1 }] },
    { orderId: '乙', parts: [{ name: '小板', width: 400, height: 500, quantity: 1 }] },
  ],
});
assert.strictEqual(r4.orders[0].costCents, 5400);
assert.strictEqual(r4.orders[1].costCents, 3600);
checkConsistency(r4, 9000);

// 5) 多板混合：逐板分摊与订单汇总一致性（含锯缝、含跨板订单）
const r5 = cutOrders({
  boardWidth: 1000, boardHeight: 1000, kerf: 5, boardPrice: 33.33,
  orders: [
    { orderId: 'O1', parts: [{ name: '横板', width: 600, height: 1000, quantity: 1 }] },
    { orderId: 'O2', parts: [{ name: '竖板', width: 380, height: 1000, quantity: 1 }] },
    { orderId: 'O3', parts: [{ name: '方板', width: 700, height: 700, quantity: 1 }] },
    { orderId: 'O4', parts: [{ name: '补板', width: 280, height: 700, quantity: 1 }] },
  ],
});
assert.strictEqual(r5.boardsCount, 2);
checkConsistency(r5, 3333);
console.log('5) 多板分摊通过：', r5.orders.map((o) => `${o.orderId}=${o.cost}元`).join('，'),
  '，合计', r5.totalCost, '元');

// 6) 免费板（材料价 0 / 缺省）：分摊全 0 但仍保持一致
const r6 = cutOrders({
  boardWidth: 1000, boardHeight: 500, kerf: 0,
  orders: [{ orderId: 'Z', parts: [{ name: 'a', width: 500, height: 500, quantity: 1 }] }],
});
assert.strictEqual(r6.boardPriceCents, 0);
assert.strictEqual(r6.totalCostCents, 0);
assert.strictEqual(r6.orders[0].costCents, 0);
checkConsistency(r6, 0);

// 7) 输入校验
const base = { boardWidth: 1000, boardHeight: 500, kerf: 0, boardPrice: 10 };
assert.throws(() => cutOrders({ ...base, orders: [] }), UserError); // 无订单
assert.throws(() => cutOrders({
  ...base,
  orders: [
    { orderId: 'A', parts: [{ name: 'a', width: 1, height: 1, quantity: 1 }] },
    { orderId: 'A', parts: [{ name: 'b', width: 1, height: 1, quantity: 1 }] },
  ],
}), UserError); // 订单号重复
assert.throws(() => cutOrders({
  ...base,
  orders: [{ orderId: '  ', parts: [{ name: 'a', width: 1, height: 1, quantity: 1 }] }],
}), UserError); // 订单号空白
assert.throws(() => cutOrders({
  ...base,
  orders: [{ orderId: 'A', parts: [] }],
}), UserError); // 订单无零件
assert.throws(() => cutOrders({
  ...base,
  orders: [{
    orderId: 'A',
    parts: [
      { name: 'a', width: 1, height: 1, quantity: 1 },
      { name: 'a', width: 2, height: 2, quantity: 1 },
    ],
  }],
}), UserError); // 订单内零件重名
assert.throws(() => cutOrders({
  ...base, boardPrice: -1,
  orders: [{ orderId: 'A', parts: [{ name: 'a', width: 1, height: 1, quantity: 1 }] }],
}), UserError); // 板价为负
assert.throws(() => cutOrders({
  ...base, boardPrice: 12.345,
  orders: [{ orderId: 'A', parts: [{ name: 'a', width: 1, height: 1, quantity: 1 }] }],
}), UserError); // 板价超过两位小数
assert.throws(() => cutOrders({
  ...base,
  orders: [{ orderId: 'A', parts: [{ name: 'a', width: 2000, height: 1, quantity: 1 }] }],
}), UserError); // 零件放不进原板

// 8) 两位小数板价合法边界
const r8 = cutOrders({
  ...base, boardPrice: 0.99,
  orders: [{ orderId: 'A', parts: [{ name: 'a', width: 1000, height: 500, quantity: 1 }] }],
});
assert.strictEqual(r8.boardPriceCents, 99);
assert.strictEqual(r8.orders[0].costCents, 99);

console.log('全部多订单拼版自检通过 ✔');
