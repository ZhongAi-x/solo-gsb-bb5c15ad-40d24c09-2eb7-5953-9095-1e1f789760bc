'use strict';

/**
 * 断头切割 (guillotine cut) 排料算法
 *
 * 规则：
 *  - 坐标原点在左上角，x 向右、y 向下，单位与输入一致（通常为 mm）。
 *  - 零件按“用户输入的固定顺序”展开（数量 n 即连续 n 件同名零件），不做大小重排。
 *    多订单拼版时，按订单输入顺序依次排料：先排完一个订单的全部零件行，
 *    再排下一个订单；每件落位都保留其订单归属。
 *  - 每件零件允许旋转 90°；在余量相同的情况下优先不旋转。
 *  - 每件零件放入某个当前可用矩形区域的左上角，释放该零件需要：
 *      * 竖切方案：先沿零件右边竖切一刀（贯穿该区域全高），再在左侧余料上横切一刀；
 *      * 横切方案：先沿零件下边横切一刀（贯穿该区域全宽），再在上侧余料上竖切一刀。
 *    两种方案中，锯缝宽度均从“余料一侧”扣除，选择锯缝损失更小的方案，平局取竖切。
 *  - 每一刀都贯穿其所在的当前矩形区域；沿板材边缘的修整切也会被记录（缝宽可能小于
 *    标准锯缝，因为余边不足一条完整锯缝）。零件恰好占满方向时不产生该方向的刀。
 *  - 零件在所有已开板材上都放不下时才开启新板；全部板材均无法容纳的零件直接报错。
 *
 * 多订单材料费分摊：
 *  - 每张原板材料价（元，非负、最多两位小数）先换算成“分”；
 *  - 每张板按各订单在该板的零件实际面积比例分摊该板材料费，
 *    尾差用最大余数法逐分分配，余数相同时按订单输入顺序优先；
 *  - 因而每板各订单分摊额之和恰好等于该板板价，各订单跨板汇总之和
 *    恰好等于全部用板的总板价。
 */

const EPS = 1e-9;

class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.statusCode = 400;
  }
}

function num(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new UserError(`${field} 必须是数字`);
  }
  return n;
}

function positiveInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new UserError(`${field} 必须是不小于 1 的整数`);
  }
  return n;
}

/**
 * 计算一次左上角落料后产生的刀路与两个余料矩形。
 * 区域 fr 左上角 (x,y)，宽 frW、高 frH；零件占位 w×h；锯缝 k。
 * verticalFirst=true 时先竖切，否则先横切。
 */
function buildSplit(fr, w, h, k, verticalFirst) {
  const { x, y, w: frW, h: frH } = fr;
  const rw = Math.max(0, frW - w);
  const rh = Math.max(0, frH - h);
  const cuts = [];
  const rects = [];

  if (verticalFirst) {
    // A：竖切，贯穿区域全高；右侧有余量才需要分离（锯缝为 0 时缝带宽度为 0，刀仍记录）
    const hasV = rw > EPS;
    const bA = hasV ? Math.min(k, rw) : 0;
    if (hasV) {
      cuts.push({
        type: 'v',
        band: { x: x + w, y, w: bA, h: frH },
      });
    }
    // B：在左侧（宽度恰好为 w 的）料块上横切；若没有竖切，则横切贯穿整板宽
    const spanW = hasV ? w : frW;
    const hasH = rh > EPS;
    const bB = hasH ? Math.min(k, rh) : 0;
    if (hasH) {
      cuts.push({
        type: 'h',
        band: { x, y: y + h, w: spanW, h: bB },
      });
    }
    // 右余料（竖切右侧，全高）
    if (rw - bA > EPS && frH > EPS) {
      rects.push({ x: x + w + bA, y, w: rw - bA, h: frH });
    }
    // 下余料（横切下方）
    if (rh - bB > EPS && spanW > EPS) {
      rects.push({ x, y: y + h + bB, w: spanW, h: rh - bB });
    }
  } else {
    // A：横切，贯穿区域全宽；下方有余量才需要分离
    const hasH = rh > EPS;
    const bA = hasH ? Math.min(k, rh) : 0;
    if (hasH) {
      cuts.push({
        type: 'h',
        band: { x, y: y + h, w: frW, h: bA },
      });
    }
    // B：在上侧（高度恰好为 h 的）料块上竖切；若没有横切，则竖切贯穿整板高
    const spanH = hasH ? h : frH;
    const hasV = rw > EPS;
    const bB = hasV ? Math.min(k, rw) : 0;
    if (hasV) {
      cuts.push({
        type: 'v',
        band: { x: x + w, y, w: bB, h: spanH },
      });
    }
    // 下余料（横切下方，全宽）
    if (rh - bA > EPS && frW > EPS) {
      rects.push({ x, y: y + h + bA, w: frW, h: rh - bA });
    }
    // 右余料（竖切右侧）
    if (rw - bB > EPS && spanH > EPS) {
      rects.push({ x: x + w + bB, y, w: rw - bB, h: spanH });
    }
  }

  const freeArea = rects.reduce((s, r) => s + r.w * r.h, 0);
  return { cuts, rects, freeArea };
}

function makeBoard(width, height) {
  return {
    width,
    height,
    free: [{ x: 0, y: 0, w: width, h: height }],
    placements: [],
    cuts: [],
    partsArea: 0,
    kerfArea: 0,
  };
}

/** 校验并取出原板参数（长、宽、锯缝） */
function boardParams(input) {
  const boardWidth = num(input.boardWidth, '原板长度');
  const boardHeight = num(input.boardHeight, '原板宽度');
  const kerf = input.kerf === undefined || input.kerf === null || input.kerf === ''
    ? 0
    : num(input.kerf, '锯缝宽度');

  if (boardWidth <= 0) throw new UserError('原板长度必须大于 0');
  if (boardHeight <= 0) throw new UserError('原板宽度必须大于 0');
  if (kerf < 0) throw new UserError('锯缝宽度不能为负数');
  return { boardWidth, boardHeight, kerf };
}

/**
 * 校验一行零件，返回规范化的 { name, width, height, quantity }。
 * namePrefix 为未填写名称时的默认名；usedNames 用于（同一订单内）查重。
 */
function validatePartRow(p, namePrefix, usedNames, boardWidth, boardHeight) {
  const src = p && typeof p === 'object' ? p : {};
  const name = (src.name === undefined || src.name === null || String(src.name).trim() === '')
    ? namePrefix
    : String(src.name).trim();
  if (usedNames.has(name)) {
    throw new UserError(`零件名称重复：${name}`);
  }
  usedNames.add(name);

  const w = num(src.width, `零件「${name}」的长度`);
  const h = num(src.height, `零件「${name}」的宽度`);
  const q = positiveInt(src.quantity, `零件「${name}」的数量`);
  if (w <= 0) throw new UserError(`零件「${name}」的长度必须大于 0`);
  if (h <= 0) throw new UserError(`零件「${name}」的宽度必须大于 0`);

  // 旋转后仍无法放入整板，直接报错
  const fitsNormal = w <= boardWidth + EPS && h <= boardHeight + EPS;
  const fitsRotated = h <= boardWidth + EPS && w <= boardHeight + EPS;
  if (!fitsNormal && !fitsRotated) {
    throw new UserError(
      `零件「${name}」尺寸 ${w} × ${h} 旋转后仍无法放入原板 ${boardWidth} × ${boardHeight}`
    );
  }

  return { name, width: w, height: h, quantity: q };
}

/**
 * 排料主循环：parts 为已校验零件行，按下料顺序排列；
 * 每行可带 order 字段表示订单归属（会随落位一起记录）。
 * 返回内部板材数组。
 */
function nestParts(parts, boardWidth, boardHeight, kerf) {
  const boards = [];

  // 按固定输入顺序逐件排料
  for (const part of parts) {
    for (let q = 1; q <= part.quantity; q++) {
      const orientations = [{ w: part.width, h: part.height, rotated: false }];
      if (Math.abs(part.width - part.height) > EPS) {
        orientations.push({ w: part.height, h: part.width, rotated: true });
      }

      let best = null; // { boardIndex, freeIndex, ori, split, fr, score }

      const betterScore = (a, b) => {
        for (let idx = 0; idx < a.length; idx++) {
          if (a[idx] < b[idx] - EPS) return true;
          if (a[idx] > b[idx] + EPS) return false;
        }
        return false; // 完全相同，保留先出现的候选
      };

      for (let bi = 0; bi < boards.length; bi++) {
        const board = boards[bi];
        for (let fi = 0; fi < board.free.length; fi++) {
          const fr = board.free[fi];
          for (const ori of orientations) {
            if (ori.w > fr.w + EPS || ori.h > fr.h + EPS) continue;
            const w = Math.min(ori.w, fr.w);
            const h = Math.min(ori.h, fr.h);

            const vSplit = buildSplit(fr, w, h, kerf, true);
            const hSplit = buildSplit(fr, w, h, kerf, false);
            // 锯缝损失更小（余料面积更大）的方案优先，平局取竖切
            const split = hSplit.freeArea > vSplit.freeArea + EPS ? hSplit : vSplit;

            // 评分：最紧凑的可用区域 → 余料损失最小 → 靠上 → 靠左 → 已开板 → 不旋转
            const score = [
              fr.w * fr.h,
              -split.freeArea,
              fr.y,
              fr.x,
              bi,
              ori.rotated ? 1 : 0,
            ];
            if (!best || betterScore(score, best.score)) {
              best = { boardIndex: bi, freeIndex: fi, ori, split, fr, score };
            }
          }
        }
      }

      // 现有板材均放不下 → 开新板
      if (!best) {
        const board = makeBoard(boardWidth, boardHeight);
        boards.push(board);
        const fr = board.free[0];
        // 取能放入整板的第一个朝向（非旋转优先，正方形只有一个朝向）
        const ori0 = orientations.find((o) => o.w <= fr.w + EPS && o.h <= fr.h + EPS);
        if (!ori0) {
          // 理论上不会发生：入参校验阶段已拦截
          throw new UserError(
            `零件「${part.name}」尺寸 ${part.width} × ${part.height} 无法放入原板 ${boardWidth} × ${boardHeight}`
          );
        }
        const w = Math.min(ori0.w, fr.w);
        const h = Math.min(ori0.h, fr.h);
        const vSplit = buildSplit(fr, w, h, kerf, true);
        const hSplit = buildSplit(fr, w, h, kerf, false);
        const split = hSplit.freeArea > vSplit.freeArea + EPS ? hSplit : vSplit;
        best = { boardIndex: boards.length - 1, freeIndex: 0, ori: ori0, split, fr };
      }

      const board = boards[best.boardIndex];
      const fr = best.fr;
      const { ori, split } = best;
      const w = Math.min(ori.w, fr.w);
      const h = Math.min(ori.h, fr.h);

      board.placements.push({
        ...(part.order !== undefined ? { order: part.order } : {}),
        part: part.name,
        index: q,
        x: fr.x,
        y: fr.y,
        w,
        h,
        rotated: ori.rotated,
      });
      board.partsArea += w * h;
      for (const c of split.cuts) {
        board.cuts.push(c);
        board.kerfArea += c.band.w * c.band.h;
      }
      board.free.splice(best.freeIndex, 1, ...split.rects);
    }
  }

  return boards;
}

const round3 = (v) => Math.abs(v) < EPS ? 0 : Math.round(v * 1000) / 1000;

/** 输出整理：编号、端点坐标、面积统计（落位保留订单归属 order 字段） */
function formatBoards(boards) {
  return boards.map((b, bi) => {
    const cuts = b.cuts.map((c, i) => {
      const seq = i + 1;
      const { band } = c;
      const base = { seq, type: c.type, band: { x: round3(band.x), y: round3(band.y), w: round3(band.w), h: round3(band.h) } };
      if (c.type === 'v') {
        const cx = band.x + band.w / 2;
        return { ...base, x1: round3(cx), y1: round3(band.y), x2: round3(cx), y2: round3(band.y + band.h), length: round3(band.h) };
      }
      const cy = band.y + band.h / 2;
      return { ...base, x1: round3(band.x), y1: round3(cy), x2: round3(band.x + band.w), y2: round3(cy), length: round3(band.w) };
    });

    const boardArea = b.width * b.height;
    const remainderArea = boardArea - b.partsArea - b.kerfArea;
    return {
      index: bi + 1,
      width: round3(b.width),
      height: round3(b.height),
      placements: b.placements.map((p) => ({
        ...(p.order !== undefined ? { order: p.order } : {}),
        part: p.part,
        index: p.index,
        x: round3(p.x),
        y: round3(p.y),
        w: round3(p.w),
        h: round3(p.h),
        rotated: p.rotated,
      })),
      cuts,
      partsArea: round3(b.partsArea),
      kerfArea: round3(b.kerfArea),
      remainderArea: round3(remainderArea),
      utilization: Math.round((b.partsArea / boardArea) * 1000) / 10,
    };
  });
}

/** 汇总统计（用板总面积、零件/锯缝/余料面积、利用率） */
function summarize(resultBoards, boardWidth, boardHeight) {
  const totalArea = resultBoards.length * boardWidth * boardHeight;
  const partsArea = resultBoards.reduce((s, b) => s + b.partsArea, 0);
  const kerfArea = resultBoards.reduce((s, b) => s + b.kerfArea, 0);
  const remainderArea = totalArea - partsArea - kerfArea;
  return {
    totalArea: round3(totalArea),
    partsArea: round3(partsArea),
    kerfArea: round3(kerfArea),
    remainderArea: round3(remainderArea),
    utilization: totalArea > 0 ? Math.round((partsArea / totalArea) * 1000) / 10 : 0,
  };
}

/**
 * 单订单排料。
 * input: { boardWidth, boardHeight, kerf, parts: [{ name, width, height, quantity }] }
 * 返回逐板裁切方案；输入不合法或零件无法放入原板时抛 UserError。
 */
function cutBoards(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }

  const { boardWidth, boardHeight, kerf } = boardParams(input);

  const rawParts = Array.isArray(input.parts) ? input.parts : [];
  if (rawParts.length === 0) {
    throw new UserError('请至少添加一种零件');
  }
  if (rawParts.length > 500) {
    throw new UserError('零件种类过多（最多 500 种）');
  }

  const parts = [];
  let totalQty = 0;
  const usedNames = new Set();

  rawParts.forEach((p, i) => {
    const row = validatePartRow(p, `零件${i + 1}`, usedNames, boardWidth, boardHeight);
    totalQty += row.quantity;
    if (totalQty > 10000) {
      throw new UserError('零件总数量过多（最多 10000 件）');
    }
    parts.push(row);
  });

  const resultBoards = formatBoards(nestParts(parts, boardWidth, boardHeight, kerf));

  return {
    boardWidth: round3(boardWidth),
    boardHeight: round3(boardHeight),
    kerf: round3(kerf),
    boardsCount: resultBoards.length,
    totalParts: totalQty,
    ...summarize(resultBoards, boardWidth, boardHeight),
    boards: resultBoards,
  };
}

/**
 * 每张原板材料价（元）→ 分。非负、最多两位小数；缺省按 0 处理。
 */
function priceToCents(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new UserError('每张原板材料价必须是数字');
  }
  if (n < 0) {
    throw new UserError('每张原板材料价不能为负数');
  }
  if (n > 1e8) {
    throw new UserError('每张原板材料价超出允许范围');
  }
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) {
    throw new UserError('每张原板材料价最多两位小数');
  }
  return cents;
}

/**
 * 最大余数法分摊：把 priceCents（分）按 entries 中各订单的零件面积比例分配。
 * 先按精确份额向下取整，剩余尾差按“余数大者优先”逐分补齐；
 * 余数相同（1e-9 以内）时按 entries 顺序（即订单输入顺序）优先。
 * 返回与 entries 等长的整数数组，其和恰好等于 priceCents。
 */
function allocateByArea(priceCents, entries) {
  if (priceCents === 0 || entries.length === 0) {
    return entries.map(() => 0);
  }
  const totalArea = entries.reduce((s, e) => s + e.area, 0);
  // 板上至少有一件正面积零件，totalArea 必然大于 0
  const shares = entries.map((e) => (priceCents * e.area) / totalArea);
  const floors = shares.map((s) => Math.floor(s + 1e-9));
  let remainder = priceCents - floors.reduce((s, v) => s + v, 0);

  const order = entries.map((_, i) => i).sort((a, b) => {
    const ra = shares[a] - floors[a];
    const rb = shares[b] - floors[b];
    if (ra > rb + 1e-9) return -1;
    if (rb > ra + 1e-9) return 1;
    return a - b; // 同余时按订单输入顺序
  });

  const cents = floors.slice();
  for (let k = 0; k < order.length && remainder > 0; k++) {
    cents[order[k]] += 1;
    remainder -= 1;
  }
  return cents;
}

/**
 * 多订单拼版。
 * input: {
 *   boardWidth, boardHeight, kerf,
 *   boardPrice,                       // 每张原板材料价（元，非负、最多两位小数）
 *   orders: [{ orderId, parts: [{ name, width, height, quantity }] }]
 * }
 * 按订单输入顺序及其零件行输入顺序断头切割，落位保留订单归属；
 * 结果按订单汇总跨板零件（件号、板号、坐标）并按面积比例分摊材料费。
 */
function cutOrders(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }

  const { boardWidth, boardHeight, kerf } = boardParams(input);
  const priceCents = priceToCents(input.boardPrice);

  const rawOrders = Array.isArray(input.orders) ? input.orders : [];
  if (rawOrders.length === 0) {
    throw new UserError('请至少添加一个订单');
  }
  if (rawOrders.length > 100) {
    throw new UserError('订单数量过多（最多 100 个）');
  }

  const usedOrderIds = new Set();
  const orderIds = [];
  const parts = []; // 全部订单的零件行，按订单输入顺序拼接
  let totalQty = 0;

  rawOrders.forEach((o, oi) => {
    const src = o && typeof o === 'object' ? o : {};
    const orderId = (src.orderId === undefined || src.orderId === null)
      ? ''
      : String(src.orderId).trim();
    if (!orderId) {
      throw new UserError(`第 ${oi + 1} 个订单的订单号不能为空`);
    }
    if (orderId.length > 50) {
      throw new UserError(`订单号过长（最多 50 个字符）：${orderId.slice(0, 20)}…`);
    }
    if (usedOrderIds.has(orderId)) {
      throw new UserError(`订单号重复：${orderId}`);
    }
    usedOrderIds.add(orderId);
    orderIds.push(orderId);

    const rawParts = Array.isArray(src.parts) ? src.parts : [];
    if (rawParts.length === 0) {
      throw new UserError(`订单「${orderId}」请至少添加一种零件`);
    }
    if (rawParts.length > 500) {
      throw new UserError(`订单「${orderId}」零件种类过多（最多 500 种）`);
    }

    // 名称只在订单内查重：不同订单允许使用同名零件
    const usedNames = new Set();
    rawParts.forEach((p, pi) => {
      const row = validatePartRow(p, `零件${pi + 1}`, usedNames, boardWidth, boardHeight);
      totalQty += row.quantity;
      if (totalQty > 10000) {
        throw new UserError('全部订单零件总数量过多（最多 10000 件）');
      }
      parts.push({ ...row, order: orderId });
    });
  });

  const resultBoards = formatBoards(nestParts(parts, boardWidth, boardHeight, kerf));

  // —— 分单取件汇总 + 逐板材料费分摊 ——
  const costByOrder = new Map(orderIds.map((id) => [id, 0]));
  const areaByOrderAll = new Map(orderIds.map((id) => [id, 0]));
  const itemsByOrder = new Map(orderIds.map((id) => [id, []]));

  for (const b of resultBoards) {
    // 该板上各订单的零件实际面积（订单按输入顺序首次出现）
    const areaByOrder = new Map();
    for (const p of b.placements) {
      areaByOrder.set(p.order, (areaByOrder.get(p.order) || 0) + p.w * p.h);
      itemsByOrder.get(p.order).push({
        part: p.part,
        index: p.index,
        board: b.index,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        rotated: p.rotated,
      });
    }

    const entries = [...areaByOrder.entries()].map(([order, area]) => ({ order, area }));
    const cents = allocateByArea(priceCents, entries);
    b.costShares = entries.map((e, i) => ({
      order: e.order,
      partsArea: round3(e.area),
      amountCents: cents[i],
      amount: cents[i] / 100,
    }));
    entries.forEach((e, i) => {
      costByOrder.set(e.order, costByOrder.get(e.order) + cents[i]);
      areaByOrderAll.set(e.order, areaByOrderAll.get(e.order) + e.area);
    });
  }

  const orders = orderIds.map((orderId) => {
    const items = itemsByOrder.get(orderId);
    const costCents = costByOrder.get(orderId);
    return {
      orderId,
      partsCount: items.length,
      partsArea: round3(areaByOrderAll.get(orderId)),
      costCents,
      cost: costCents / 100,
      items,
    };
  });

  const totalCostCents = resultBoards.length * priceCents;

  return {
    boardWidth: round3(boardWidth),
    boardHeight: round3(boardHeight),
    kerf: round3(kerf),
    boardPrice: priceCents / 100,
    boardPriceCents: priceCents,
    boardsCount: resultBoards.length,
    ordersCount: orderIds.length,
    totalParts: totalQty,
    ...summarize(resultBoards, boardWidth, boardHeight),
    totalCostCents,
    totalCost: totalCostCents / 100,
    boards: resultBoards,
    orders,
  };
}

module.exports = { cutBoards, cutOrders, UserError };
