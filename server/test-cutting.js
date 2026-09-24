/* 排料算法自检：面积守恒、刀路几何、多板、旋转与报错路径 */
'use strict';
const assert = require('assert');
const { cutBoards, UserError } = require('./src/cutting');

// 1) 示例数据：面积守恒 + 基本字段
const r = cutBoards({
  boardWidth: 2440, boardHeight: 1220, kerf: 3,
  parts: [
    { name: '柜门', width: 600, height: 400, quantity: 4 },
    { name: '侧板', width: 800, height: 350, quantity: 3 },
    { name: '抽屉面', width: 500, height: 200, quantity: 6 },
    { name: '背板条', width: 1000, height: 120, quantity: 2 },
  ],
});
assert.ok(r.boardsCount >= 1);
for (const b of r.boards) {
  const boardArea = b.width * b.height;
  assert(Math.abs(boardArea - b.partsArea - b.kerfArea - b.remainderArea) < 0.01,
    `板 ${b.index} 面积不守恒`);
  // 零件不得超出原板
  for (const p of b.placements) {
    assert(p.x >= -1e-6 && p.y >= -1e-6, '零件起点越界');
    assert(p.x + p.w <= b.width + 1e-6 && p.y + p.h <= b.height + 1e-6, '零件越界');
  }
  // 零件两两不重叠
  const ps = b.placements;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j];
      const overlap = a.x < c.x + c.w - 1e-6 && c.x < a.x + a.w - 1e-6 &&
        a.y < c.y + c.h - 1e-6 && c.y < a.y + a.h - 1e-6;
      assert(!overlap, `板 ${b.index} 零件重叠：${a.part}/${c.part}`);
    }
  }
  // 刀序从 1 连续，每刀端点在板内
  b.cuts.forEach((cut, i) => {
    assert.strictEqual(cut.seq, i + 1);
    assert(cut.x1 >= -1e-6 && cut.x2 <= b.width + 1e-6);
    assert(cut.y1 >= -1e-6 && cut.y2 <= b.height + 1e-6);
  });
}
assert.strictEqual(r.totalParts, 15);
assert.strictEqual(r.boards[0].cuts.length > 0, true, '应有刀路');
console.log('用板数:', r.boardsCount, '| 余料:', r.remainderArea, '| 锯缝:', r.kerfArea, '| 利用率:', r.utilization + '%');

// 2) 零件恰好铺满：无刀、余料 0
const full = cutBoards({
  boardWidth: 1000, boardHeight: 600, kerf: 2,
  parts: [{ name: '整板', width: 1000, height: 600, quantity: 1 }],
});
assert.strictEqual(full.boardsCount, 1);
assert.strictEqual(full.boards[0].cuts.length, 0);
assert.strictEqual(full.remainderArea, 0);

// 3) 锯缝为 0：仍记录刀序，仍有余料矩形
const k0 = cutBoards({
  boardWidth: 1000, boardHeight: 500, kerf: 0,
  parts: [{ name: 'A', width: 400, height: 300, quantity: 2 }],
});
assert.ok(k0.boards[0].cuts.length >= 2, '零锯缝也应有切割刀路');
assert.strictEqual(k0.kerfArea, 0);
assert.strictEqual(k0.partsArea + k0.remainderArea, 500000);

// 4) 必须旋转才能放下
const rot = cutBoards({
  boardWidth: 500, boardHeight: 300, kerf: 0,
  parts: [{ name: '横条', width: 280, height: 400, quantity: 1 }], // 正向 280x400 放不下，旋转后 400x280 可以
});
assert.strictEqual(rot.boards[0].placements[0].rotated, true);

// 5) 旋转后仍放不下 → 报错
assert.throws(() => cutBoards({
  boardWidth: 500, boardHeight: 300, kerf: 0,
  parts: [{ name: '大块', width: 400, height: 400, quantity: 1 }],
}), UserError);

// 6) 多板：每件 600x400，板 1200x800 恰好 2x2 放 4 件，9 件需要 3 张
const multi = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  parts: [{ name: '块', width: 600, height: 400, quantity: 9 }],
});
assert.strictEqual(multi.boardsCount, 3);
assert.deepStrictEqual(multi.boards.map((b) => b.placements.length), [4, 4, 1]);

// 7) 锯缝计入：600x400 两件并排放在 1203 宽板上（600+3+600），宽度刚好
const kerfFit = cutBoards({
  boardWidth: 1203, boardHeight: 400, kerf: 3,
  parts: [{ name: '条', width: 600, height: 400, quantity: 2 }],
});
assert.strictEqual(kerfFit.boardsCount, 1);
assert.strictEqual(kerfFit.boards[0].cuts.length, 1); // 只有竖切一刀
assert.strictEqual(kerfFit.kerfArea, 3 * 400);

// 8) 锯缝挤压：1202 宽放不下两件 → 第二件开新板
const noFit = cutBoards({
  boardWidth: 1202, boardHeight: 400, kerf: 3,
  parts: [{ name: '条', width: 600, height: 400, quantity: 2 }],
});
assert.strictEqual(noFit.boardsCount, 2);

// 9) 输入校验
assert.throws(() => cutBoards({ boardWidth: 0, boardHeight: 10, kerf: 0, parts: [{ name: 'a', width: 1, height: 1, quantity: 1 }] }), UserError);
assert.throws(() => cutBoards({ boardWidth: 10, boardHeight: 10, kerf: -1, parts: [{ name: 'a', width: 1, height: 1, quantity: 1 }] }), UserError);
assert.throws(() => cutBoards({ boardWidth: 10, boardHeight: 10, kerf: 0, parts: [] }), UserError);
assert.throws(() => cutBoards({ boardWidth: 10, boardHeight: 10, kerf: 0, parts: [{ name: 'a', width: 5, height: 5, quantity: 0 }] }), UserError);

console.log('全部算法自检通过 ✔');
