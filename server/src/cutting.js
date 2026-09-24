'use strict';

/**
 * 断头切割 (guillotine cut) 排料算法
 *
 * 规则：
 *  - 坐标原点在左上角，x 向右、y 向下，单位与输入一致（通常为 mm）。
 *  - 零件按“用户输入的固定顺序”展开（数量 n 即连续 n 件同名零件），不做大小重排。
 *  - 每件零件允许旋转 90°；在余量相同的情况下优先不旋转。
 *  - 每件零件放入某个当前可用矩形区域的左上角，释放该零件需要：
 *      * 竖切方案：先沿零件右边竖切一刀（贯穿该区域全高），再在左侧余料上横切一刀；
 *      * 横切方案：先沿零件下边横切一刀（贯穿该区域全宽），再在上侧余料上竖切一刀。
 *    两种方案中，锯缝宽度均从“余料一侧”扣除，选择锯缝损失更小的方案，平局取竖切。
 *  - 每一刀都贯穿其所在的当前矩形区域；沿板材边缘的修整切也会被记录（缝宽可能小于
 *    标准锯缝，因为余边不足一条完整锯缝）。零件恰好占满方向时不产生该方向的刀。
 *  - 零件在所有已开板材上都放不下时才开启新板；全部板材均无法容纳的零件直接报错。
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

/**
 * 主入口。
 * input: { boardWidth, boardHeight, kerf, parts: [{ name, width, height, quantity }] }
 * 返回逐板裁切方案；输入不合法或零件无法放入原板时抛 UserError。
 */
function cutBoards(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }

  const boardWidth = num(input.boardWidth, '原板长度');
  const boardHeight = num(input.boardHeight, '原板宽度');
  const kerf = input.kerf === undefined || input.kerf === null || input.kerf === ''
    ? 0
    : num(input.kerf, '锯缝宽度');

  if (boardWidth <= 0) throw new UserError('原板长度必须大于 0');
  if (boardHeight <= 0) throw new UserError('原板宽度必须大于 0');
  if (kerf < 0) throw new UserError('锯缝宽度不能为负数');

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
    const name = (p.name === undefined || p.name === null || String(p.name).trim() === '')
      ? `零件${i + 1}`
      : String(p.name).trim();
    if (usedNames.has(name)) {
      throw new UserError(`零件名称重复：${name}`);
    }
    usedNames.add(name);

    const w = num(p.width, `零件「${name}」的长度`);
    const h = num(p.height, `零件「${name}」的宽度`);
    const q = positiveInt(p.quantity, `零件「${name}」的数量`);
    if (w <= 0) throw new UserError(`零件「${name}」的长度必须大于 0`);
    if (h <= 0) throw new UserError(`零件「${name}」的宽度必须大于 0`);

    totalQty += q;
    if (totalQty > 10000) {
      throw new UserError('零件总数量过多（最多 10000 件）');
    }

    // 旋转后仍无法放入整板，直接报错
    const fitsNormal = w <= boardWidth + EPS && h <= boardHeight + EPS;
    const fitsRotated = h <= boardWidth + EPS && w <= boardHeight + EPS;
    if (!fitsNormal && !fitsRotated) {
      throw new UserError(
        `零件「${name}」尺寸 ${w} × ${h} 旋转后仍无法放入原板 ${boardWidth} × ${boardHeight}`
      );
    }

    parts.push({ name, width: w, height: h, quantity: q });
  });

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

  // 输出整理：编号、端点坐标、面积统计
  const r = (v) => Math.abs(v) < EPS ? 0 : Math.round(v * 1000) / 1000;

  const resultBoards = boards.map((b, bi) => {
    const cuts = b.cuts.map((c, i) => {
      const seq = i + 1;
      const { band } = c;
      const base = { seq, type: c.type, band: { x: r(band.x), y: r(band.y), w: r(band.w), h: r(band.h) } };
      if (c.type === 'v') {
        const cx = band.x + band.w / 2;
        return { ...base, x1: r(cx), y1: r(band.y), x2: r(cx), y2: r(band.y + band.h), length: r(band.h) };
      }
      const cy = band.y + band.h / 2;
      return { ...base, x1: r(band.x), y1: r(cy), x2: r(band.x + band.w), y2: r(cy), length: r(band.w) };
    });

    const boardArea = b.width * b.height;
    const remainderArea = boardArea - b.partsArea - b.kerfArea;
    return {
      index: bi + 1,
      width: r(b.width),
      height: r(b.height),
      placements: b.placements.map((p) => ({
        part: p.part,
        index: p.index,
        x: r(p.x),
        y: r(p.y),
        w: r(p.w),
        h: r(p.h),
        rotated: p.rotated,
      })),
      cuts,
      partsArea: r(b.partsArea),
      kerfArea: r(b.kerfArea),
      remainderArea: r(remainderArea),
      utilization: Math.round((b.partsArea / boardArea) * 1000) / 10,
    };
  });

  const totalArea = boards.length * boardWidth * boardHeight;
  const partsArea = resultBoards.reduce((s, b) => s + b.partsArea, 0);
  const kerfArea = resultBoards.reduce((s, b) => s + b.kerfArea, 0);
  const remainderArea = totalArea - partsArea - kerfArea;

  return {
    boardWidth: r(boardWidth),
    boardHeight: r(boardHeight),
    kerf: r(kerf),
    boardsCount: boards.length,
    totalParts: totalQty,
    totalArea: r(totalArea),
    partsArea: r(partsArea),
    kerfArea: r(kerfArea),
    remainderArea: r(remainderArea),
    utilization: Math.round((partsArea / totalArea) * 1000) / 10,
    boards: resultBoards,
  };
}

module.exports = { cutBoards, UserError };
