/**
 * 中国象棋 — 本地对战 + 联机对战
 * =====================================================
 * 模块：
 *   1. CONFIG        — 常量
 *   2. ChessLogic    — 走棋规则
 *   3. BoardRenderer — Canvas 渲染
 *   4. TimerUI       — 倒计时圆环（联机用）
 *   5. LocalGame     — 本地对战逻辑
 *   6. OnlineGame    — 联机对战逻辑（WebSocket）
 *   7. App           — 入口 + 大厅流程 + Canvas 事件分发
 * =====================================================
 */
'use strict';

/* ====================================================
   1. CONFIG
   ==================================================== */
const CONFIG = {
  COLS: 9, ROWS: 10,
  CANVAS_W: 630, CANVAS_H: 700,
  PADDING: 45,
  CELL: 68,
  PIECE_R: 30,
  TURN_SECS: 30,
  SWAP_ROUNDS: 2,
  WS_URL: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws-chess',
};

// 后端 piece_type 映射（后端用大写，前端用小写）
const PIECE_TYPES = {
  KING:'king', ADVISOR:'advisor', ELEPHANT:'elephant',
  KNIGHT:'knight', ROOK:'rook', CANNON:'cannon', PAWN:'pawn'
};

// 棋子中文名映射
const PIECE_NAMES = {
  red: { KING:'帅', ADVISOR:'仕', ELEPHANT:'相', KNIGHT:'馬', ROOK:'車', CANNON:'炮', PAWN:'兵' },
  black: { KING:'将', ADVISOR:'士', ELEPHANT:'象', KNIGHT:'馬', ROOK:'車', CANNON:'砲', PAWN:'卒' }
};

// 棋子初始布局（type 使用大写与后端 server.py 保持一致）
const INITIAL_BOARD = [
  [{type:'ROOK',color:'black'},{type:'KNIGHT',color:'black'},{type:'ELEPHANT',color:'black'},{type:'ADVISOR',color:'black'},{type:'KING',color:'black'},{type:'ADVISOR',color:'black'},{type:'ELEPHANT',color:'black'},{type:'KNIGHT',color:'black'},{type:'ROOK',color:'black'}],
  [null,null,null,null,null,null,null,null,null],
  [null,{type:'CANNON',color:'black'},null,null,null,null,null,{type:'CANNON',color:'black'},null],
  [{type:'PAWN',color:'black'},null,{type:'PAWN',color:'black'},null,{type:'PAWN',color:'black'},null,{type:'PAWN',color:'black'},null,{type:'PAWN',color:'black'}],
  [null,null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null,null],
  [{type:'PAWN',color:'red'},null,{type:'PAWN',color:'red'},null,{type:'PAWN',color:'red'},null,{type:'PAWN',color:'red'},null,{type:'PAWN',color:'red'}],
  [null,{type:'CANNON',color:'red'},null,null,null,null,null,{type:'CANNON',color:'red'},null],
  [null,null,null,null,null,null,null,null,null],
  [{type:'ROOK',color:'red'},{type:'KNIGHT',color:'red'},{type:'ELEPHANT',color:'red'},{type:'ADVISOR',color:'red'},{type:'KING',color:'red'},{type:'ADVISOR',color:'red'},{type:'ELEPHANT',color:'red'},{type:'KNIGHT',color:'red'},{type:'ROOK',color:'red'}],
];

/* ====================================================
   2. ChessLogic — 走棋规则
   ==================================================== */
const ChessLogic = (() => {
  function inPalace(row, col, color) {
    if (col < 3 || col > 5) return false;
    if (row < 0 || row >= CONFIG.ROWS) return false;
    if (color === 'red') return row >= 7;
    return row <= 2;
  }

  function elephantBlocked(board, row, col, dr, dc) {
    const eyeRow = row + dr / 2, eyeCol = col + dc / 2;
    if (eyeRow < 0 || eyeRow >= CONFIG.ROWS || eyeCol < 0 || eyeCol >= CONFIG.COLS) return true;
    return board[eyeRow][eyeCol] !== null;
  }

  function knightBlocked(board, row, col, lr, lc) {
    const nr = row + lr, nc = col + lc;
    if (nr < 0 || nr >= CONFIG.ROWS || nc < 0 || nc >= CONFIG.COLS) return true;
    return board[nr][nc] !== null;
  }

  function getLinearPath(board, fromRow, fromCol, toRow, toCol) {
    const path = [];
    const dR = Math.sign(toRow - fromRow), dC = Math.sign(toCol - fromCol);
    if (dR !== 0 && dC !== 0) return path;
    const steps = Math.max(Math.abs(toRow - fromRow), Math.abs(toCol - fromCol));
    for (let i = 1; i < steps; i++) path.push({ row: fromRow + i * dR, col: fromCol + i * dC });
    return path;
  }

  function findKing(board, color) {
    for (let r = 0; r < CONFIG.ROWS; r++)
      for (let c = 0; c < CONFIG.COLS; c++) {
        const p = board[r][c];
        if (p && (p.type === 'KING' || p.type === 'king') && p.color === color) return { row: r, col: c };
      }
    return null;
  }

  function isInCheck(board, color) {
    const king = findKing(board, color);
    if (!king) return false;
    const enemy = color === 'red' ? 'black' : 'red';
    // 将帅对面：同列且中间无子，视为被"将"
    if (kingsFacing(board)) return true;
    for (let r = 0; r < CONFIG.ROWS; r++)
      for (let c = 0; c < CONFIG.COLS; c++) {
        const p = board[r][c];
        if (!p || p.color !== enemy) continue;
        const moves = getRawMoves(board, r, c, p, true);
        if (moves.some(m => m.row === king.row && m.col === king.col)) return true;
      }
    return false;
  }

  // 从后端大写 type 转为前端小写 type
  function normalizeType(t) { return PIECE_TYPES[t] || t; }

  // 从后端棋子数据还原前端格式
  function fromBackendPiece(p) {
    if (!p) return null;
    if (typeof p === 'object') return { type: normalizeType(p.type), color: p.color };
    return null;
  }

  function kingsFacing(board) {
    const rk = findKing(board, 'red'), bk = findKing(board, 'black');
    if (!rk || !bk) return false;
    if (rk.col !== bk.col) return false;
    for (let r = bk.row + 1; r < rk.row; r++) if (board[r][rk.col] !== null) return false;
    return true;
  }

  function getRawMoves(board, row, col, piece, ignoreKingFacing = false) {
    const moves = [];
    const type = (piece.type || '').toUpperCase(); // 统一转大写
    const color = piece.color;
    const enemy = color === 'red' ? 'black' : 'red';

    switch (type) {
      case 'KING':
        for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const nr = row+dr, nc = col+dc;
          if (!inPalace(nr, nc, color)) continue;
          const t = board[nr][nc];
          if (t && t.color === color) continue;
          moves.push({ row: nr, col: nc });
        }
        { const ok = findKing(board, enemy);
          if (ok && ok.col === col && !ignoreKingFacing) moves.push({ row: ok.row, col: ok.col }); }
        break;

      case 'ADVISOR':
        for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
          const nr = row+dr, nc = col+dc;
          if (!inPalace(nr, nc, color)) continue;
          const t = board[nr][nc];
          if (t && t.color === color) continue;
          moves.push({ row: nr, col: nc });
        }
        break;

      case 'ELEPHANT':
        for (const [dr, dc] of [[2,2],[2,-2],[-2,2],[-2,-2]]) {
          const nr = row+dr, nc = col+dc;
          if (nr < 0 || nr >= CONFIG.ROWS || nc < 0 || nc >= CONFIG.COLS) continue;
          if (color === 'red' && nr < 5) continue;
          if (color === 'black' && nr >= 5) continue;
          if (elephantBlocked(board, row, col, dr, dc)) continue;
          const t = board[nr][nc];
          if (t && t.color === color) continue;
          moves.push({ row: nr, col: nc });
        }
        break;

      case 'KNIGHT':
        for (const [dr, dc, lr, lc] of [
          [-2,-1,-1,0],[-2,1,-1,0],[2,-1,1,0],[2,1,1,0],
          [-1,-2,0,-1],[-1,2,0,1],[1,-2,0,-1],[1,2,0,1]
        ]) {
          const nr = row+dr, nc = col+dc;
          if (nr < 0 || nr >= CONFIG.ROWS || nc < 0 || nc >= CONFIG.COLS) continue;
          if (knightBlocked(board, row, col, lr, lc)) continue;
          const t = board[nr][nc];
          if (t && t.color === color) continue;
          moves.push({ row: nr, col: nc });
        }
        break;

      case 'ROOK':
        for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          for (let i = 1; i < Math.max(CONFIG.ROWS, CONFIG.COLS); i++) {
            const nr = row+dr*i, nc = col+dc*i;
            if (nr < 0 || nr >= CONFIG.ROWS || nc < 0 || nc >= CONFIG.COLS) break;
            const t = board[nr][nc];
            if (t) { if (t.color === enemy) moves.push({ row: nr, col: nc }); break; }
            moves.push({ row: nr, col: nc });
          }
        }
        break;

      case 'CANNON':
        for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          let screen = false;
          for (let i = 1; i < Math.max(CONFIG.ROWS, CONFIG.COLS); i++) {
            const nr = row+dr*i, nc = col+dc*i;
            if (nr < 0 || nr >= CONFIG.ROWS || nc < 0 || nc >= CONFIG.COLS) break;
            const t = board[nr][nc];
            if (!screen) { if (t) screen = true; else moves.push({ row: nr, col: nc }); }
            else { if (t) { if (t.color === enemy) moves.push({ row: nr, col: nc }); break; } }
          }
        }
        break;

      case 'PAWN':
        const fw = color === 'red' ? -1 : 1;
        const crossed = color === 'red' ? row <= 4 : row >= 5;
        const fr = row+fw;
        if (fr >= 0 && fr < CONFIG.ROWS) {
          const tf = board[fr][col];
          if (!tf || tf.color === enemy) moves.push({ row: fr, col });
        }
        if (crossed) {
          for (const dc of [1, -1]) {
            const nc = col+dc;
            if (nc >= 0 && nc < CONFIG.COLS) {
              const t = board[row][nc];
              if (!t || t.color === enemy) moves.push({ row, col: nc });
            }
          }
        }
        break;
    }
    return moves;
  }

  function getValidMoves(board, row, col) {
    const piece = board[row][col];
    if (!piece) return [];
    const raw = getRawMoves(board, row, col, piece);
    return raw.filter(m => {
      const captured = board[m.row][m.col];
      board[m.row][m.col] = piece;
      board[row][col] = null;
      const chk = isInCheck(board, piece.color);
      board[row][col] = piece;
      board[m.row][m.col] = captured;
      return !chk;
    });
  }

  function isCheckmate(board, color) {
    for (let r = 0; r < CONFIG.ROWS; r++)
      for (let c = 0; c < CONFIG.COLS; c++) {
        const p = board[r][c];
        if (!p || p.color !== color) continue;
        if (getValidMoves(board, r, c).length > 0) return false;
      }
    return true;
  }

  function moveToNotation(fromRow, fromCol, toRow, toCol, piece) {
    const cols = 'abcdefghi';
    return PIECE_NAMES[piece.color][piece.type] + cols[fromCol] + (fromRow+1) + '→' + cols[toCol] + (toRow+1);
  }

  return { getValidMoves, isInCheck, isCheckmate, findKing, kingsFacing, moveToNotation, INITIAL_BOARD, PIECE_NAMES };
})();


/* ====================================================
   3. BoardRenderer — Canvas
   ==================================================== */
const BoardRenderer = (() => {
  let canvas, ctx;
  let lastMove = null;
  let checkTimer = null;

  let dpr = 1; // devicePixelRatio 缓存

  function init(el) {
    canvas = el;
    ctx = el.getContext('2d');
  }

  function px(col, row) {
    return { x: CONFIG.PADDING + col * CONFIG.CELL, y: CONFIG.PADDING + row * CONFIG.CELL };
  }

  function toGrid(mouseX, mouseY) {
    const c = Math.round((mouseX - CONFIG.PADDING) / CONFIG.CELL);
    const r = Math.round((mouseY - CONFIG.PADDING) / CONFIG.CELL);
    if (c < 0 || c >= CONFIG.COLS || r < 0 || r >= CONFIG.ROWS) return null;
    const p = px(c, r);
    return Math.hypot(mouseX - p.x, mouseY - p.y) <= CONFIG.PIECE_R ? { col: c, row: r } : null;
  }

  function eventToGrid(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = CONFIG.CANVAS_W / rect.width, sy = CONFIG.CANVAS_H / rect.height;
    return toGrid((e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy);
  }

  function drawBoard() {
    ctx.fillStyle = '#dcb96a';
    ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    const g = ctx.createLinearGradient(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    g.addColorStop(0, 'rgba(180,110,30,.08)');
    g.addColorStop(.5, 'rgba(220,175,90,.04)');
    g.addColorStop(1, 'rgba(160,100,20,.1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);

    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 1.5;

    // 竖线（楚河汉界断开）
    for (let c = 0; c < CONFIG.COLS; c++) {
      const p = px(c, 0);
      ctx.beginPath();
      ctx.moveTo(p.x, px(0, 0).y);
      if (c === 0 || c === 8) ctx.lineTo(p.x, px(0, CONFIG.ROWS-1).y);
      else { ctx.lineTo(p.x, px(0, 4).y); ctx.moveTo(p.x, px(0, 5).y); ctx.lineTo(p.x, px(0, CONFIG.ROWS-1).y); }
      ctx.stroke();
    }
    // 横线
    for (let r = 0; r < CONFIG.ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(px(0, r).x, px(0, r).y);
      ctx.lineTo(px(CONFIG.COLS-1, r).x, px(0, r).y);
      ctx.stroke();
    }

    // 九宫斜线
    const drawPalace = (c1, c2, r1, r2) => {
      ctx.beginPath();
      ctx.moveTo(px(c1, r1).x, px(c1, r1).y); ctx.lineTo(px(c2, r2).x, px(c2, r2).y);
      ctx.moveTo(px(c1, r2).x, px(c1, r2).y); ctx.lineTo(px(c2, r1).x, px(c2, r1).y);
      ctx.stroke();
    };
    drawPalace(3, 5, 7, 9); // 红方九宫
    drawPalace(3, 5, 0, 2);  // 黑方九宫

    // 楚河汉界
    ctx.fillStyle = '#5a3a1a';
    ctx.font = 'bold 22px KaiTi, STKaiti, "SimSun", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const midY = (px(0, 4).y + px(0, 5).y) / 2;
    const boardLeft = px(0, 0).x;
    const boardW = px(8, 0).x - boardLeft;
    ctx.fillText('楚 河', boardLeft + boardW / 4, midY);
    ctx.fillText('漢 界', boardLeft + boardW * 3 / 4, midY);

    // 标记点
    const marks = [[1,2],[7,2],[1,7],[7,7],[0,3],[2,3],[4,3],[6,3],[8,3],[0,6],[2,6],[4,6],[6,6],[8,6]];
    ctx.fillStyle = '#5a3a1a';
    marks.forEach(([c, r]) => {
      const p = px(c, r);
      const s = 4;
      ctx.beginPath(); ctx.moveTo(p.x-s, p.y); ctx.lineTo(p.x+s, p.y);
      ctx.moveTo(p.x, p.y-s); ctx.lineTo(p.x, p.y+s);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI*2); ctx.fill();
    });

    // 坐标
    ctx.font = '12px sans-serif';
    const cols = '九八七六五四三二一';
    for (let c = 0; c < CONFIG.COLS; c++) ctx.fillText(cols[c], px(c, 0).x, CONFIG.PADDING - 16);
  }

  function drawPiece(col, row, piece, highlight) {
    const p = px(col, row), r = CONFIG.PIECE_R;
    const isRed = piece.color === 'red';

    // --- 1. 投影 ---
    ctx.save();
    ctx.shadowColor = 'rgba(30,15,0,.45)';
    ctx.shadowBlur = 6 * dpr;
    ctx.shadowOffsetX = 2 * dpr;
    ctx.shadowOffsetY = 3 * dpr;

    // --- 2. 底座（比棋子稍大，深色木质） ---
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = isRed ? '#7a2828' : '#2a2a2a';
    ctx.fill();
    ctx.restore();

    // --- 3. 主体：径向渐变（从高光到暗角，模拟凸面） ---
    const gd = ctx.createRadialGradient(
      p.x - r * 0.25, p.y - r * 0.25, r * 0.05,
      p.x, p.y, r
    );
    gd.addColorStop(0, '#fffdf5');
    gd.addColorStop(0.35, '#fdf5e6');
    gd.addColorStop(0.7, '#e8d5b0');
    gd.addColorStop(1, '#c8a86a');

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = gd;
    ctx.fill();

    // --- 4. 外圈（立体浮雕边框） ---
    ctx.beginPath();
    ctx.arc(p.x, p.y, r - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = isRed ? '#a02020' : '#222';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // --- 5. 内圈（经典双圈棋子样式） ---
    ctx.beginPath();
    ctx.arc(p.x, p.y, r - 5.5, 0, Math.PI * 2);
    ctx.strokeStyle = isRed ? '#b83030' : '#333';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // --- 6. 顶部光泽高光 ---
    const hl = ctx.createRadialGradient(
      p.x - r * 0.2, p.y - r * 0.35, 0,
      p.x - r * 0.2, p.y - r * 0.35, r * 0.7
    );
    hl.addColorStop(0, 'rgba(255,255,255,.35)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(p.x, p.y, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = hl;
    ctx.fill();

    // --- 7. 棋子文字（关闭平滑以获得锐利文字） ---
    const name = PIECE_NAMES[piece.color][piece.type];
    const fontSize = Math.round(r * 0.88);
    ctx.font = `bold ${fontSize}px "KaiTi","STKaiti","FangSong","SimSun","Noto Serif SC",serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 半像素偏移保证文字清晰（避免亚像素抗锯齿）
    const tx = Math.round(p.x) + 0.5;
    const ty = Math.round(p.y + 1) + 0.5;

    // 文字描边（增加可读性和立体感）
    ctx.strokeStyle = isRed ? 'rgba(140,20,20,.3)' : 'rgba(0,0,0,.25)';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.strokeText(name, tx, ty);

    // 文字填充
    ctx.fillStyle = isRed ? '#b02020' : '#1a1a1a';
    ctx.fillText(name, tx, ty);

    // --- 8. 选中高亮 ---
    if (highlight) {
      ctx.save();
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#ffcc00';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawValidMoves(board, validMoves, selectedPiece) {
    validMoves.forEach(m => {
      const p = px(m.col, m.row);
      const target = board[m.row][m.col];
      if (target) {
        ctx.beginPath(); ctx.arc(p.x, p.y, CONFIG.PIECE_R+4, 0, Math.PI*2);
        ctx.strokeStyle = 'rgba(220,60,60,.7)'; ctx.lineWidth = 3; ctx.stroke();
      } else {
        ctx.globalAlpha = 0.45;
        ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI*2);
        ctx.fillStyle = selectedPiece && selectedPiece.color === 'red' ? '#c03030' : '#303030';
        ctx.fill(); ctx.globalAlpha = 1;
      }
    });
  }

  function drawLastMove(from, to, movedPieceColor, currentColor) {
    if (!from || !to) return;

    // 起点标记：半透明虚线方框
    const fp = px(from.col, from.row);
    const s = CONFIG.PIECE_R + 4;
    ctx.strokeStyle = 'rgba(136,204,68,.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(fp.x - s, fp.y - s, s * 2, s * 2);
    ctx.setLineDash([]);

    // 终点棋子光环：判断"自己的"还是"对方的"
    // "自己的" = 刚走棋的一方（movedPieceColor），对于当前回合方来说是对方的棋子刚走过来
    // 所以如果 movedPieceColor != currentColor，说明是对方刚走的，用红光；否则是当前方刚走的，用白光
    const isOwn = movedPieceColor === currentColor;
    const glowRGBA = isOwn ? 'rgba(255,255,255,.55)' : 'rgba(255,60,60,.5)';

    const tp = px(to.col, to.row);
    ctx.save();
    ctx.shadowColor = glowRGBA;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = glowRGBA;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, CONFIG.PIECE_R + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function renderAll(board, opts) {
    opts = opts || {};
    lastMove = opts.lastMove || null;
    drawBoard();

    if (opts.selected && opts.valid && opts.valid.length > 0)
      drawValidMoves(board, opts.valid, board[opts.selected.row] ? board[opts.selected.row][opts.selected.col] : null);

    for (let r = 0; r < CONFIG.ROWS; r++)
      for (let c = 0; c < CONFIG.COLS; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        const sel = opts.selected;
        const isSel = sel && sel.row === r && sel.col === c;
        drawPiece(c, r, piece, isSel);
      }

    if (lastMove && lastMove.from && lastMove.to) drawLastMove(lastMove.from, lastMove.to, opts.movedColor, opts.currentColor);

    if (opts.checkColor) startCheckFlash(opts.checkColor, board);
    else stopCheckFlash();
  }

  function startCheckFlash(color, board) {
    if (checkTimer) return;
    const king = ChessLogic.findKing(board, color);
    if (!king) return;
    let show = false;
    checkTimer = setInterval(() => {
      show = !show;
      const p = px(king.col, king.row);
      ctx.strokeStyle = show ? '#ff4444' : '#ffcc00';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, CONFIG.PIECE_R+4, 0, Math.PI*2);
      ctx.stroke();
    }, 400);
  }

  function stopCheckFlash() {
    if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
  }

  let checkAlertTimer = null;
  function showCheckAlert(color, onDismiss) {
    if (checkAlertTimer) clearTimeout(checkAlertTimer);
    const cx = CONFIG.CANVAS_W / 2;
    const cy = CONFIG.CANVAS_H / 2;
    const text = '将军！';
    const bgColor = color === 'red' ? 'rgba(180,30,30,.82)' : 'rgba(30,30,30,.82)';
    ctx.save();
    ctx.font = 'bold 52px "KaiTi","STKaiti","SimSun","Microsoft YaHei",serif';
    const tw = ctx.measureText(text).width;
    const pad = 28;
    // 背景圆角矩形
    const rx = cx - tw/2 - pad, ry = cy - 36, rw = tw + pad*2, rh = 72, br = 12;
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.moveTo(rx+br, ry); ctx.lineTo(rx+rw-br, ry);
    ctx.quadraticCurveTo(rx+rw, ry, rx+rw, ry+br);
    ctx.lineTo(rx+rw, ry+rh-br);
    ctx.quadraticCurveTo(rx+rw, ry+rh, rx+rw-br, ry+rh);
    ctx.lineTo(rx+br, ry+rh);
    ctx.quadraticCurveTo(rx, ry+rh, rx, ry+rh-br);
    ctx.lineTo(rx, ry+br);
    ctx.quadraticCurveTo(rx, ry, rx+br, ry);
    ctx.closePath(); ctx.fill();
    // 描边
    ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 2.5; ctx.stroke();
    // 文字
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6;
    ctx.fillText(text, cx, cy + 2);
    ctx.restore();
    // 0.75 秒后回调重绘以覆盖提示
    checkAlertTimer = setTimeout(() => {
      checkAlertTimer = null;
      if (typeof onDismiss === 'function') onDismiss();
    }, 750);
  }

  return { init, toGrid, eventToGrid, drawBoard, drawPiece, renderAll, startCheckFlash, stopCheckFlash, showCheckAlert };
})();


/* ====================================================
   4. TimerUI — 倒计时圆环
   ==================================================== */
const TimerUI = (() => {
  const C = 2 * Math.PI * 34;
  let elNum, elArc, raf = null, deadline = 0;
  let timeoutCallback = null;

  function init() {
    elNum = document.getElementById('timerNum');
    elArc = document.getElementById('timerArc');
  }
  function start(ms, onTimeout) { deadline = ms; timeoutCallback = onTimeout || null; stop(); tick(); }
  function stop() {
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    timeoutCallback = null;
    _set(CONFIG.TURN_SECS, false);
  }
  function tick() {
    const rem = Math.max(0, (deadline - Date.now()) / 1000);
    _set(rem, rem <= 10);
    if (rem > 0) { raf = requestAnimationFrame(tick); }
    else if (timeoutCallback) { timeoutCallback(); }
  }
  function _set(rem, urg) {
    elNum.textContent = Math.ceil(rem);
    elArc.style.strokeDashoffset = C * (1 - rem / CONFIG.TURN_SECS);
    elArc.classList.toggle('urgent', urg);
  }
  return { init, start, stop };
})();


/* ====================================================
   5. LocalGame — 本地对战
   ==================================================== */
const LocalGame = (() => {
  let board = [], history = [], current = 'red', over = false;
  let selected = null, validMoves = [];

  function reset() {
    board = ChessLogic.INITIAL_BOARD.map(row => row.map(p => p ? {...p} : null));
    history = []; current = 'red'; over = false;
    selected = null; validMoves = [];
  }

  function select(row, col) {
    if (over) return null;
    const piece = board[row][col];
    if (selected) {
      if (validMoves.some(m => m.row === row && m.col === col)) return doMove(selected.row, selected.col, row, col);
      if (piece && piece.color === current) {
        selected = { row, col };
        validMoves = ChessLogic.getValidMoves(board, row, col);
        return { type: 'select', pos: selected, moves: validMoves };
      }
      selected = null; validMoves = [];
      return { type: 'deselect' };
    } else {
      if (piece && piece.color === current) {
        selected = { row, col };
        validMoves = ChessLogic.getValidMoves(board, row, col);
        return { type: 'select', pos: selected, moves: validMoves };
      }
    }
    return null;
  }

  function doMove(fromRow, fromCol, toRow, toCol) {
    if (over) return { ok: false };
    const piece = board[fromRow][fromCol];
    if (!piece) return { ok: false };
    const moves = ChessLogic.getValidMoves(board, fromRow, fromCol);
    if (!moves.some(m => m.row === toRow && m.col === toCol)) return { ok: false };

    const captured = board[toRow][toCol];
    const capturedKing = captured && (captured.type === 'KING' || captured.type === 'king');
    const notation = ChessLogic.moveToNotation(fromRow, fromCol, toRow, toCol, piece);
    board[toRow][toCol] = piece;
    board[fromRow][fromCol] = null;
    history.push({ from:{row:fromRow,col:fromCol}, to:{row:toRow,col:toCol}, piece:{...piece}, captured: captured?{...captured}:null, notation });
    selected = null; validMoves = [];

    const next = current === 'red' ? 'black' : 'red';
    const lm = { from:{row:fromRow,col:fromCol}, to:{row:toRow,col:toCol} };

    // 兜底：吃掉对方将/帅直接判胜
    if (capturedKing) { over = true; return { ok:true, win:true, winner:current, reason:'capture_king', lastMove:lm, captured, notation }; }

    if (ChessLogic.isCheckmate(board, next)) { over = true; return { ok:true, win:true, winner:current, lastMove:lm, captured, notation }; }

    current = next;
    return { ok:true, win:false, lastMove:lm, captured, notation };
  }

  function undo() {
    if (!history.length) return null;
    const m = history.pop();
    board[m.from.row][m.from.col] = m.piece;
    board[m.to.row][m.to.col] = m.captured;
    current = m.piece.color;
    over = false; selected = null; validMoves = [];
    return m;
  }

  function getBoard() { return board; }
  function getHistory() { return history; }
  function getCurrent() { return current; }
  function getSelected() { return selected; }
  function getValidMoves() { return validMoves; }
  function isOver() { return over; }
  function setOver() { over = true; }
  function isEmpty(col, row) { return board[row][col] === null; }
  function isInCheck(color) { return ChessLogic.isInCheck(board, color); }

  return { reset, select, undo, getBoard, getHistory, getCurrent, getSelected, getValidMoves, isOver, setOver, isEmpty, isInCheck };
})();


/* ====================================================
   6. OnlineGame — 联机对战
   ==================================================== */
const OnlineGame = (() => {
  let ws = null, handlers = {};
  let board = [], history = [], myColor = null, current = 'red', over = false;
  let roomName = '', myName = '', opponentName = '';
  let names = { red:'', black:'' };
  let scores = { red:0, black:0, draw:0 };
  let roundNum = 1;

  function on(t, fn) { handlers[t] = fn; }
  function send(type, data = {}) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
  }
  function close() { if (ws) { ws.onclose = null; ws.close(); ws = null; } }
  function isConnected() { return ws && ws.readyState === 1; }

  function connect(room, name) {
    return new Promise((resolve, reject) => {
      roomName = room; myName = name;
      ws = new WebSocket(CONFIG.WS_URL);
      const timer = setTimeout(() => { reject(new Error('连接超时')); ws.close(); }, 5000);
      ws.onopen = () => { clearTimeout(timer); ws.send(JSON.stringify({ type:'join', room, name })); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('无法连接服务器')); };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } const fn = handlers[m.type]; if (fn) fn(m); };
      ws.onclose = () => { clearTimeout(timer); const fn = handlers['_close']; if (fn) fn(); };
    });
  }

  function requestRematch() { send('rematch'); }
  function replyRematch(accept) { send('rematch_reply', { accept }); }
  function requestUndo() { send('undo'); }
  function replyUndo(accept) { send('undo_reply', { accept }); }
  function makeMove(fromRow, fromCol, toRow, toCol) { send('move', { from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol } }); }

  function setupHandlers(onStart, onTurn, onMoved, onGameOver, onOpponentLeft, onWaiting, onRematchRequest, onRematchResult, onInfo, onUndoRequest, onUndoDone, onUndoRejected) {
    on('waiting', () => { if (onWaiting) onWaiting(); });
    on('info', (msg) => { if (onInfo) onInfo(msg.msg || msg); });

    on('start', (msg) => {
      board = ChessLogic.INITIAL_BOARD.map(row => row.map(p => p ? {...p} : null));
      history = []; over = false;
      myColor = msg.color; current = 'red';
      names = msg.names || { red:'', black:'' };
      scores = msg.scores || { red:0, black:0, draw:0 };
      roundNum = msg.round || 1;
      opponentName = myColor === 'red' ? names.black : names.red;
      if (onStart) onStart(msg.color, msg);
    });

    on('turn', (msg) => {
      current = msg.color;
      if (onTurn) onTurn(msg.color, msg.deadline);
    });

    on('moved', (msg) => {
      const { from, to, captured } = msg;
      // captured 是字符串（如 "車"）或 null；棋子从 board 提取
      const p = board[from.row][from.col];
      board[to.row][to.col] = p;
      board[from.row][from.col] = null;
      const capturedObj = captured ? { type: captured, color: null } : null;
      history.push({ from, to, piece: p ? {...p} : null, captured: capturedObj });
      if (onMoved) onMoved(from, to, p, capturedObj, { from, to });
    });

    on('over', (msg) => {
      over = true;
      if (msg.winner !== 'draw') {
        const winName = names[msg.winner] || (msg.winner === 'red' ? '红方' : '黑方');
        scores[winName] = (scores[winName]||0) + 1;
      }
      if (onGameOver) onGameOver(msg.winner, msg.reason);
    });

    on('opponent_left', () => { if (onOpponentLeft) onOpponentLeft(); });
    on('undo_request', (msg) => { if (onUndoRequest) onUndoRequest(msg.from); });
    on('undo_done', (msg) => {
      // 后端发回单个 move: { from, to, captured:"車"|null }
      // board 已由后端重置，前端只需同步 history
      const m = msg.move;
      if (m && history.length) history.pop();
      if (onUndoDone) onUndoDone(m ? [m] : []);
    });
    on('undo_rejected', () => { if (onUndoRejected) onUndoRejected(); });
    on('rematch_request', (msg) => { if (onRematchRequest) onRematchRequest(msg.from); });
    on('rematch_result', (msg) => { if (onRematchResult) onRematchResult(msg.accepted); });
    on('error', (msg) => { console.warn('服务端:', msg.msg); });
  }

  function getBoard() { return board; }
  function getHistory() { return history; }
  function getMyColor() { return myColor; }
  function getCurrent() { return current; }
  function getNames() { return names; }
  function getScores() { return scores; }
  function getRoundNum() { return roundNum; }
  function getOpponentName() { return opponentName; }
  function getRoomName() { return roomName; }
  function getMyName() { return myName; }
  function isMyTurn() { return !over && current === myColor; }
  function isOver() { return over; }

  return { on, connect, close, isConnected, setupHandlers, requestRematch, replyRematch, requestUndo, replyUndo, makeMove, getBoard, getHistory, getMyColor, getCurrent, getNames, getScores, getRoundNum, getOpponentName, getRoomName, getMyName, isMyTurn, isOver };
})();


/* ====================================================
   7. App — 入口 + 大厅 + UI
   ==================================================== */
const App = (() => {
  let mode = null;
  let scores = { red:0, black:0 };
  let hoverCell = null;
  let selected = null, validMoves = [], lastMove = null;
  let onlineSelected = null; // 联机模式下选中的棋子位置 {from:{row,col}, piece}

  // DOM
  let elCanvas, elTurnDot, elTurnText;
  let elHistoryList, elRedScore, elBlackScore, elRedNameLabel, elBlackNameLabel;
  let elRoomLabel, elMyColorCard, elMyColorDot, elMyColorName;
  let elTimerCard, elBtnRestart, elBtnUndo, elBtnLeave;
  let elModalOverlay, elModalIcon, elModalTitle, elModalDesc, elModalBtnGroup;
  let elRoundInfo, elRoundText;

  function init() {
    elCanvas = document.getElementById('board');
    elTurnDot = document.getElementById('turnDot');
    elTurnText = document.getElementById('turnText');
    elHistoryList = document.getElementById('historyList');
    elRedScore = document.getElementById('redScore');
    elBlackScore = document.getElementById('blackScore');
    elRedNameLabel = document.getElementById('redNameLabel');
    elBlackNameLabel = document.getElementById('blackNameLabel');
    elRoomLabel = document.getElementById('roomLabel');
    elMyColorCard = document.getElementById('myColorCard');
    elMyColorDot = document.getElementById('myColorDot');
    elMyColorName = document.getElementById('myColorName');
    elTimerCard = document.getElementById('timerCard');
    elBtnRestart = document.getElementById('btnRestart');
    elBtnUndo = document.getElementById('btnUndo');
    elBtnLeave = document.getElementById('btnLeave');
    elModalOverlay = document.getElementById('modalOverlay');
    elModalIcon = document.getElementById('modalIcon');
    elModalTitle = document.getElementById('modalTitle');
    elModalDesc = document.getElementById('modalDesc');
    elModalBtnGroup = document.getElementById('modalBtnGroup');
    elRoundInfo = document.getElementById('roundInfo');
    elRoundText = document.getElementById('roundText');

    BoardRenderer.init(elCanvas);
    TimerUI.init();
    _bindLobby();
  }

  /* ── 大厅 ─────────────────────── */
  function _showStep(id) {
    document.querySelectorAll('.lobby-step').forEach(el => el.style.display = 'none');
    document.getElementById(id).style.display = '';
  }

  function _bindLobby() {
    document.getElementById('btnLocal').onclick = () => { AudioFX.play('click'); _enterLocal(); };
    document.getElementById('btnOnline').onclick = () => { AudioFX.play('click'); _showStep('stepName'); };
    document.getElementById('btnBackFromName').onclick = () => { AudioFX.play('click'); _showStep('stepMode'); };
    document.getElementById('btnNameConfirm').onclick = () => { AudioFX.play('click'); _afterNameInput(); };
    document.getElementById('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') _afterNameInput(); });
    document.getElementById('btnBackMode').onclick = () => { AudioFX.play('click'); _showStep('stepMode'); };
    document.getElementById('btnCreate').onclick = () => { AudioFX.play('click'); _createRoom(); };
    document.getElementById('btnJoin').onclick = () => { AudioFX.play('click'); _showStep('stepJoin'); };
    document.getElementById('btnBackOnline1').onclick = () => { AudioFX.play('click'); _showStep('stepOnline'); };
    document.getElementById('btnBackOnline2').onclick = () => { AudioFX.play('click'); _showStep('stepOnline'); };
    document.getElementById('btnJoinConfirm').onclick = () => { AudioFX.play('click'); _joinRoom(); };
    document.getElementById('roomInput').addEventListener('keydown', e => { if (e.key === 'Enter') _joinRoom(); });
    document.getElementById('btnCopy').onclick = () => {
      const code = document.getElementById('roomCode').textContent;
      const btn = document.getElementById('btnCopy');
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(code).then(() => { btn.textContent = '已复制'; setTimeout(() => btn.textContent = '复制', 1500); });
      else { const ta = document.createElement('textarea'); ta.value = code; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); btn.textContent = '已复制'; setTimeout(() => btn.textContent = '复制', 1500); }
    };
    document.getElementById('btnBackLobby').onclick = () => { AudioFX.play('click'); _exitToLobby(); };
  }

  function _afterNameInput() {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) { document.getElementById('nameInput').style.borderColor = '#ff4444'; return; }
    document.getElementById('nameInput').style.borderColor = '';
    _showStep('stepOnline');
  }

  /* ── 本地对战 ─────────────────── */
  function _enterLocal() {
    mode = 'local';
    scores = { red:0, black:0 };
    LocalGame.reset();
    selected = null; validMoves = []; lastMove = null; lastMovedColor = null;
    _showGameUI(false);
    document.getElementById('timerCard').style.display = '';
    _updateScoreLabels();
    _renderLocal();
    _bindLocalCanvas();
    _updateLocalTurn();
  }

  /* ── 联机 ─────────────────── */
  async function _createRoom() {
    const name = document.getElementById('nameInput').value.trim() || '玩家';
    const room = 'chess_' + Math.random().toString(36).substring(2, 8);
    document.getElementById('roomCode').textContent = room;
    document.getElementById('createHint').textContent = '正在连接服务器…';
    _showStep('stepCreate');
    try { await OnlineGame.connect(room, name); document.getElementById('createHint').textContent = '已连接，等待对手加入…'; }
    catch (e) { document.getElementById('createHint').textContent = e.message || '连接失败'; }
  }

  async function _joinRoom() {
    const name = document.getElementById('nameInput').value.trim() || '玩家';
    const room = document.getElementById('roomInput').value.trim();
    if (!room) { document.getElementById('joinHint').textContent = '请输入房间号'; return; }
    document.getElementById('btnJoinConfirm').disabled = true;
    document.getElementById('joinHint').textContent = '连接中…';
    try { await OnlineGame.connect(room, name); }
    catch (e) { document.getElementById('joinHint').textContent = e.message || '连接失败'; }
    document.getElementById('btnJoinConfirm').disabled = false;
  }

  function _showGameUI(isOnline) {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('app').style.display = '';
    elMyColorCard.style.display = isOnline ? '' : 'none';
    elTimerCard.style.display = ''; // 本地和联机都显示倒计时
    elBtnLeave.style.display = isOnline ? '' : 'none';
    elBtnRestart.style.display = isOnline ? 'none' : '';
    elBtnUndo.style.display = '';
    elRoundInfo.style.display = isOnline ? '' : 'none';
    elRoomLabel.textContent = isOnline ? '' : '本地对战';
    elHistoryList.innerHTML = '';
    _hideModal();
  }

  function _updateScoreLabels() {
    if (mode === 'online') {
      const ns = OnlineGame.getNames();
      elRedNameLabel.textContent = ns.red || '红方';
      elBlackNameLabel.textContent = ns.black || '黑方';
      const sc = OnlineGame.getScores();
      elRedScore.textContent = sc[ns.red] != null ? sc[ns.red] : (sc.red||0);
      elBlackScore.textContent = sc[ns.black] != null ? sc[ns.black] : (sc.black||0);
      elRoundText.textContent = '第 ' + OnlineGame.getRoundNum() + ' 局';
    } else {
      elRedNameLabel.textContent = '红方';
      elBlackNameLabel.textContent = '黑方';
      elRedScore.textContent = scores.red;
      elBlackScore.textContent = scores.black;
    }
  }

  function _exitToLobby() {
    mode = null;
    OnlineGame.close();
    TimerUI.stop();
    document.getElementById('timerCard').style.display = 'none';
    _unbindCanvas();
    BoardRenderer.stopCheckFlash();
    onlineSelected = null;
    selected = null; validMoves = []; lastMove = null; lastMovedColor = null;
    document.getElementById('app').style.display = 'none';
    document.getElementById('lobby').style.display = '';
    _showStep('stepMode');
  }

  /* ── Canvas 事件 ─────────────────── */
  function _unbindCanvas() {
    elCanvas.onmousemove = null; elCanvas.onmouseleave = null; elCanvas.onclick = null;
    hoverCell = null;
  }

  function _bindLocalCanvas() {
    _unbindCanvas();
    elCanvas.classList.remove('not-my-turn');
    elCanvas.onmousemove = (e) => {
      if (LocalGame.isOver()) return;
      const g = BoardRenderer.eventToGrid(e);
      if (g && hoverCell && g.col === hoverCell.col && g.row === hoverCell.row) return;
      hoverCell = g;
      _renderLocal();
    };
    elCanvas.onmouseleave = () => { hoverCell = null; _renderLocal(); };
    elCanvas.onclick = (e) => {
      if (LocalGame.isOver()) return;
      const g = BoardRenderer.eventToGrid(e);
      if (!g) return;
      const result = LocalGame.select(g.row, g.col);
      if (!result) {
        // 点击了非当前方的棋子或空位
        const board = LocalGame.getBoard();
        const clickedPiece = board[g.row][g.col];
        if (clickedPiece && clickedPiece.color !== LocalGame.getCurrent()) {
          _showToast('还不到你的回合');
        }
        return;
      }

      if (result.type === 'select') {
        AudioFX.play('select');
        selected = result.pos; validMoves = result.moves;
      } else if (result.type === 'deselect') {
        selected = null; validMoves = [];
      } else if (result.ok) {
        AudioFX.play(result.captured ? 'capture' : 'place');
        lastMove = result.lastMove;
        lastMovedColor = LocalGame.getCurrent() === 'red' ? 'black' : 'red'; // 刚走棋的是上一步的颜色
        _addHistoryItem(result.notation);
        if (result.win) {
          TimerUI.stop();
          AudioFX.play('win');
          _updateScore(result.winner);
          _renderLocal();
          setTimeout(() => showModal(result.winner, result.reason), 350);
        } else {
          const nextColor = LocalGame.getCurrent();
          if (ChessLogic.isInCheck(LocalGame.getBoard(), nextColor)) {
            AudioFX.play('check');
            _showToast(nextColor === 'red' ? '红方被将军！' : '黑方被将军！');
            setTimeout(() => BoardRenderer.showCheckAlert(nextColor, _renderLocal), 50);
          }
          _renderLocal();
          _updateLocalTurn();
        }
        selected = null; validMoves = [];
        return;
      }
      _renderLocal();
    };
    elBtnRestart.onclick = () => { AudioFX.play('click'); _enterLocal(); };
    elBtnUndo.onclick = () => {
      const m = LocalGame.undo();
      if (!m) return;
      AudioFX.play('undo');
      if (elHistoryList.lastElementChild) elHistoryList.removeChild(elHistoryList.lastElementChild);
      selected = null; validMoves = []; lastMove = null;
      _renderLocal();
      _updateLocalTurn();
      BoardRenderer.stopCheckFlash();
    };
  }

  function _bindOnlineCanvas() {
    _unbindCanvas();
    elCanvas.classList.add('not-my-turn');
    elCanvas.onmousemove = (e) => {
      if (OnlineGame.isOver() || !OnlineGame.isMyTurn()) return;
      const g = BoardRenderer.eventToGrid(e);
      if (g && hoverCell && g.col === hoverCell.col && g.row === hoverCell.row) return;
      hoverCell = g;
      _renderOnline();
      // 悬停显示可走位置
      if (g && onlineSelected) {
        const vm = ChessLogic.getValidMoves(OnlineGame.getBoard(), onlineSelected.from.row, onlineSelected.from.col);
        BoardRenderer.renderAll(OnlineGame.getBoard(), {
          lastMove,
          selected: onlineSelected.from,
          valid: vm,
          checkColor: ChessLogic.isInCheck(OnlineGame.getBoard(), OnlineGame.getCurrent()) ? OnlineGame.getCurrent() : null
        });
      }
    };
    elCanvas.onmouseleave = () => { hoverCell = null; _renderOnline(); };
    elCanvas.onclick = (e) => {
      if (OnlineGame.isOver()) return;
      if (!OnlineGame.isMyTurn()) { _showToast('还不到你的回合'); return; }
      const g = BoardRenderer.eventToGrid(e);
      if (!g) return;
      const board = OnlineGame.getBoard();
      const piece = board[g.row][g.col];

      if (onlineSelected) {
        // 已有选中，看是否点可走位置
        const vm = ChessLogic.getValidMoves(board, onlineSelected.from.row, onlineSelected.from.col);
        if (vm.some(m => m.row === g.row && m.col === g.col)) {
          // 走棋 — 落子/吃子音效延迟到 onMoved 回调播放
          OnlineGame.makeMove(onlineSelected.from.row, onlineSelected.from.col, g.row, g.col);
          onlineSelected = null;
        }
        // 点其他位置，重新选中或取消
        if (piece && piece.color === OnlineGame.getMyColor()) {
          AudioFX.play('select');
          onlineSelected = { from: { row: g.row, col: g.col } };
        } else {
          onlineSelected = null;
        }
      } else {
        // 未选中，选己方棋子
        if (piece && piece.color === OnlineGame.getMyColor()) {
          AudioFX.play('select');
          onlineSelected = { from: { row: g.row, col: g.col } };
        }
      }
      _renderOnline();
    };
    elBtnLeave.onclick = () => { AudioFX.play('click'); _exitToLobby(); };
    elBtnUndo.onclick = () => { AudioFX.play('click'); OnlineGame.requestUndo(); };
  }

  /* ── 渲染 ─────────────────── */
  let lastMovedColor = null; // 记录上一步走棋的颜色

  function _renderLocal() {
    const board = LocalGame.getBoard();
    BoardRenderer.renderAll(board, {
      lastMove,
      movedColor: lastMovedColor,
      currentColor: LocalGame.getCurrent(),
      selected,
      valid: validMoves,
      checkColor: ChessLogic.isInCheck(board, LocalGame.getCurrent()) ? LocalGame.getCurrent() : null
    });
  }

  function _renderOnline() {
    const board = OnlineGame.getBoard();
    const cur = OnlineGame.getCurrent();
    let sel = null, vm = [];
    if (onlineSelected) {
      sel = onlineSelected.from;
      vm = ChessLogic.getValidMoves(board, sel.row, sel.col);
    }
    BoardRenderer.renderAll(board, {
      lastMove,
      movedColor: lastMovedColor,
      currentColor: cur,
      selected: sel,
      valid: vm,
      checkColor: ChessLogic.isInCheck(board, cur) ? cur : null
    });
  }

  function _updateLocalTurn() {
    const isRed = LocalGame.getCurrent() === 'red';
    elTurnDot.className = 'color-dot ' + (isRed ? 'red' : 'black');
    elTurnText.textContent = (isRed ? '红方' : '黑方') + '走棋';
    // 启动 30 秒倒计时
    TimerUI.start(Date.now() + CONFIG.TURN_SECS * 1000, () => {
      // 超时：当前走棋方判负
      const winner = isRed ? 'black' : 'red';
      LocalGame.setOver();
      _showToast((isRed ? '红方' : '黑方') + '超时，' + (winner === 'red' ? '红方' : '黑方') + '获胜！');
      setTimeout(() => showModal(winner, 'timeout'), 500);
    });
  }

  function _setupOnlineUI() {
    OnlineGame.setupHandlers(
      (colorName, msg) => {
        mode = 'online';
        onlineSelected = null;
        const isRed = colorName === 'red';
        elMyColorDot.className = 'color-dot ' + (isRed ? 'red' : 'black');
        elMyColorName.textContent = isRed ? '红方' : '黑方';
        elRoomLabel.textContent = '房间：' + OnlineGame.getRoomName();
        _showGameUI(true);
        _bindOnlineCanvas();
        _updateScoreLabels();
        _renderOnline();
        elTurnDot.className = 'color-dot';
        elTurnText.textContent = '等待开始…';
        if (OnlineGame.getRoundNum() > 1) _hideModal();
      },
      (colorName, deadline) => {
        const isRed = colorName === 'red';
        const mine = colorName === OnlineGame.getMyColor();
        elTurnDot.className = 'color-dot ' + (isRed ? 'red' : 'black');
        elTurnText.textContent = mine ? '轮到你走棋' : (isRed ? '红方' : '黑方') + '走棋中…';
        elCanvas.classList.toggle('not-my-turn', !mine);
        TimerUI.start(deadline);
      },
      (from, to, piece, captured, lm) => {
        AudioFX.play(captured ? 'capture' : 'place');
        lastMove = lm;
        onlineSelected = null;
        const p = piece || OnlineGame.getBoard()[to.row][to.col];
        if (p) _addHistoryItem(ChessLogic.moveToNotation(from.row, from.col, to.row, to.col, p));
        _renderOnline();
        // 将军提示
        const nextCur = OnlineGame.getCurrent();
        if (nextCur && ChessLogic.isInCheck(OnlineGame.getBoard(), nextCur)) {
          AudioFX.play('check');
          _showToast(nextCur === 'red' ? '红方被将军！' : '黑方被将军！');
          setTimeout(() => BoardRenderer.showCheckAlert(nextCur, _renderOnline), 50);
        }
      },
      (winner, reason) => {
        TimerUI.stop();
        elCanvas.classList.add('not-my-turn');
        _updateScoreLabels();
        AudioFX.play(winner === OnlineGame.getMyColor() ? 'win' : 'lose');
        _renderOnline();
        setTimeout(() => showModal(winner, reason), 400);
      },
      () => { TimerUI.stop(); elTurnText.textContent = '对手已断线'; showModal('disconnect'); },
      () => { document.getElementById('createHint').textContent = '等待对手加入…'; },
      (fromName) => _showRematchDialog(fromName),
      (accepted) => { if (!accepted) _showToast('对手拒绝了再战请求'); },
      (msg) => _showToast(msg),
      (fromName) => _showUndoDialog(fromName),
      (moves) => {
        for (let i = 0; i < (moves ? moves.length : 0); i++)
          if (elHistoryList.lastElementChild) elHistoryList.removeChild(elHistoryList.lastElementChild);
        lastMove = null;
        _renderOnline();
        _showToast('对方同意了悔棋');
      },
      () => _showToast('对方拒绝了悔棋请求')
    );
  }

  /* ── 通用 UI ─────────────────── */
  function _addHistoryItem(text) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.appendChild(document.createTextNode(text));
    elHistoryList.appendChild(li);
    elHistoryList.scrollTop = elHistoryList.scrollHeight;
  }

  function _updateScore(winner) {
    if (winner === 'red') scores.red++;
    else if (winner === 'black') scores.black++;
    elRedScore.textContent = scores.red;
    elBlackScore.textContent = scores.black;
  }

  function _showToast(msg, duration) {
    duration = duration || 3000;
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:10px 24px;border-radius:8px;z-index:9999;transition:opacity .3s;font-size:14px;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, duration);
  }

  function showModal(winner, reason) {
    let title = '', desc = '', icon = '';
    if (winner === 'disconnect') { icon = '😢'; title = '对手离开了'; desc = '对方已断开连接'; }
    else if (winner === 'draw') { icon = '🤝'; title = '平局！'; desc = '双方握手言和'; }
    else {
      const winName = winner === 'red' ? '红方' : '黑方';
      const winReason = reason === 'capture_king' ? '吃掉对方将/帅获胜' : reason === 'face' ? '将帅对脸获胜' : reason === 'timeout' ? '对方超时判负' : '将死对方获胜';
      if (mode === 'online') {
        const ns = OnlineGame.getNames();
        const actualName = ns[winner] || winName;
        icon = '🏆'; title = actualName + ' 获胜！'; desc = winReason;
      } else { icon = '🏆'; title = winName + ' 获胜！'; desc = winReason; }
    }
    elModalIcon.textContent = icon;
    elModalTitle.textContent = title;
    elModalDesc.textContent = desc;
    elModalBtnGroup.innerHTML = '';

    if (mode === 'online' && winner !== 'disconnect') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = '申请再战';
      btn.onclick = () => { OnlineGame.requestRematch(); btn.disabled = true; btn.textContent = '等待对方同意…'; };
      elModalBtnGroup.appendChild(btn);
    } else if (mode === 'local') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = '再来一局';
      btn.onclick = () => { _hideModal(); _enterLocal(); };
      elModalBtnGroup.appendChild(btn);
    }
    const btnBack = document.createElement('button');
    btnBack.className = 'btn btn-secondary';
    btnBack.textContent = '返回大厅';
    btnBack.onclick = () => { _hideModal(); _exitToLobby(); };
    elModalBtnGroup.appendChild(btnBack);
    elModalOverlay.classList.add('show');
  }

  function _showUndoDialog(fromName) {
    elModalIcon.textContent = '↩️';
    elModalTitle.textContent = fromName + ' 请求悔棋';
    elModalDesc.textContent = '对方想撤回最近一步走棋';
    elModalBtnGroup.innerHTML = '';
    const acc = document.createElement('button'); acc.className = 'btn btn-primary'; acc.textContent = '同意';
    acc.onclick = () => { OnlineGame.replyUndo(true); _hideModal(); };
    elModalBtnGroup.appendChild(acc);
    const rej = document.createElement('button'); rej.className = 'btn btn-secondary'; rej.textContent = '拒绝';
    rej.onclick = () => { OnlineGame.replyUndo(false); _hideModal(); };
    elModalBtnGroup.appendChild(rej);
    elModalOverlay.classList.add('show');
  }

  function _showRematchDialog(fromName) {
    elModalIcon.textContent = '🤝';
    elModalTitle.textContent = fromName + ' 邀请你再战一局';
    const next = OnlineGame.getRoundNum() + 1;
    elModalDesc.textContent = next % CONFIG.SWAP_ROUNDS === 0 ? '下一局将交换红黑执子' : '';
    elModalBtnGroup.innerHTML = '';
    const acc = document.createElement('button'); acc.className = 'btn btn-primary'; acc.textContent = '同意再战';
    acc.onclick = () => { OnlineGame.replyRematch(true); _hideModal(); };
    elModalBtnGroup.appendChild(acc);
    const rej = document.createElement('button'); rej.className = 'btn btn-secondary'; rej.textContent = '返回大厅';
    rej.onclick = () => { OnlineGame.replyRematch(false); _hideModal(); _exitToLobby(); };
    elModalBtnGroup.appendChild(rej);
    elModalOverlay.classList.add('show');
  }

  function _hideModal() { elModalOverlay.classList.remove('show'); }

  return { init, _setupOnlineUI, showModal };
})();

document.addEventListener('DOMContentLoaded', () => { App.init(); App._setupOnlineUI(); });
