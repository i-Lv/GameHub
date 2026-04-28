/* ======================================================================
   围棋 (Go/Weiqi) — 完整前端逻辑
   棋盘: 19×19 | 规则: 中国规则(数子法) | 打劫 | 禁入(自杀) | 数目
   ====================================================================== */

// ==================== CONFIG ====================
const CONFIG = {
  SIZE: 19,                // 棋盘大小（路数）
  CELL: 32,                // 每格像素
  PAD: 30,                 // 棋盘边距
  STONE_R: 14,             // 棋子半径
  TURN_SECS: 30,           // 联机每步限时(秒)
  KOMI: 7.5,               // 贴目(白方)
  PASS_COUNT_TO_END: 2,    // 双方连续 pass 终局
};

// 计算画布尺寸
CONFIG.WIDTH = CONFIG.PAD * 2 + (CONFIG.SIZE - 1) * CONFIG.CELL;

// 棋子颜色
const EMPTY = 0, BLACK = 1, WHITE = 2;

// 星位（19路棋盘）
const STAR_POINTS = [
  [3,3],[3,9],[3,15],
  [9,3],[9,9],[9,15],
  [15,3],[15,9],[15,15],
];

// ==================== GoLogic ====================
// 纯函数规则引擎，不持有状态
const GoLogic = (() => {
  'use strict';

  // 获取相邻交叉点（上下左右）
  function neighbors(row, col, size) {
    const n = [];
    if (row > 0) n.push([row-1, col]);
    if (row < size-1) n.push([row+1, col]);
    if (col > 0) n.push([row, col-1]);
    if (col < size-1) n.push([row, col+1]);
    return n;
  }

  // 获取一个连通块（同色相连的所有棋子）
  function getGroup(board, row, col, size) {
    const color = board[row][col];
    if (color === EMPTY) return { stones: [], liberties: new Set() };
    const visited = new Set();
    const stones = [];
    const liberties = new Set();
    const stack = [[row, col]];
    while (stack.length > 0) {
      const [r, c] = stack.pop();
      const key = r * size + c;
      if (visited.has(key)) continue;
      visited.add(key);
      stones.push([r, c]);
      for (const [nr, nc] of neighbors(r, c, size)) {
        const nk = nr * size + nc;
        if (visited.has(nk)) continue;
        if (board[nr][nc] === EMPTY) {
          liberties.add(nk);
        } else if (board[nr][nc] === color) {
          stack.push([nr, nc]);
        }
      }
    }
    return { stones, liberties };
  }

  // 检查落子是否合法（不考虑打劫）
  function isLegalMove(board, row, col, color, size, koPoint) {
    if (row < 0 || row >= size || col < 0 || col >= size) return false;
    if (board[row][col] !== EMPTY) return false;
    // 打劫禁着点
    if (koPoint && koPoint[0] === row && koPoint[1] === col) return false;

    // 尝试落子
    board[row][col] = color;
    const opp = color === BLACK ? WHITE : BLACK;
    let captured = false;

    // 检查是否提对方的子
    for (const [nr, nc] of neighbors(row, col, size)) {
      if (board[nr][nc] === opp) {
        const g = getGroup(board, nr, nc, size);
        if (g.liberties.size === 0) {
          captured = true;
          break;
        }
      }
    }

    // 如果没提子，检查自己是否有气（禁入/自杀判断）
    if (!captured) {
      const self = getGroup(board, row, col, size);
      if (self.liberties.size === 0) {
        board[row][col] = EMPTY;
        return false;
      }
    }

    board[row][col] = EMPTY;
    return true;
  }

  // 执行落子，返回 { captured: [[r,c],...], koPoint: [r,c]|null, board }
  function placeStone(board, row, col, color, size, koPoint) {
    const newBoard = board.map(r => [...r]);
    newBoard[row][col] = color;
    const opp = color === BLACK ? WHITE : BLACK;
    let totalCaptured = [];
    let singleCapture = null;

    // 提子
    for (const [nr, nc] of neighbors(row, col, size)) {
      if (newBoard[nr][nc] === opp) {
        const g = getGroup(newBoard, nr, nc, size);
        if (g.liberties.size === 0) {
          for (const [sr, sc] of g.stones) {
            newBoard[sr][sc] = EMPTY;
            totalCaptured.push([sr, sc]);
          }
          if (g.stones.length === 1) singleCapture = g.stones[0];
        }
      }
    }

    // 打劫判定：提了恰好一个子，且自己落的子恰好只有一口气
    let newKo = null;
    if (singleCapture && totalCaptured.length === 1) {
      const selfGroup = getGroup(newBoard, row, col, size);
      if (selfGroup.stones.length === 1 && selfGroup.liberties.size === 1) {
        newKo = [singleCapture[0], singleCapture[1]];
      }
    }

    return { board: newBoard, captured: totalCaptured, koPoint: newKo };
  }

  // 获取所有合法落子点
  function getLegalMoves(board, color, size, koPoint) {
    const moves = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isLegalMove(board, r, c, color, size, koPoint)) {
          moves.push([r, c]);
        }
      }
    }
    return moves;
  }

  // 中国规则数子法计算胜负
  function calculateScore(board, size, komi) {
    const territory = { [BLACK]: 0, [WHITE]: 0 };
    const stones = { [BLACK]: 0, [WHITE]: 0 };
    const visited = new Set();

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] === BLACK) stones[BLACK]++;
        else if (board[r][c] === WHITE) stones[WHITE]++;
        else if (!visited.has(r * size + c)) {
          // BFS 找空白区域
          const region = [];
          const borders = new Set();
          const stack = [[r, c]];
          while (stack.length > 0) {
            const [cr, cc] = stack.pop();
            const key = cr * size + cc;
            if (visited.has(key)) continue;
            visited.add(key);
            region.push([cr, cc]);
            for (const [nr, nc] of neighbors(cr, cc, size)) {
              const nk = nr * size + nc;
              if (board[nr][nc] === EMPTY) {
                if (!visited.has(nk)) stack.push([nr, nc]);
              } else {
                borders.add(board[nr][nc]);
              }
            }
          }
          // 只被一种颜色包围的空点算该方目数
          if (borders.size === 1) {
            const owner = borders.values().next().value;
            territory[owner] += region.length;
          }
        }
      }
    }

    const blackScore = stones[BLACK] + territory[BLACK];
    const whiteScore = stones[WHITE] + territory[WHITE] + komi;

    return {
      black: blackScore,
      white: whiteScore,
      blackTerritory: territory[BLACK],
      whiteTerritory: territory[WHITE],
      blackStones: stones[BLACK],
      whiteStones: stones[WHITE],
      winner: blackScore > whiteScore ? BLACK : WHITE,
      margin: Math.abs(blackScore - whiteScore),
    };
  }

  // 检查某一方是否还有合法走法
  function hasLegalMoves(board, color, size, koPoint) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isLegalMove(board, r, c, color, size, koPoint)) return true;
      }
    }
    return false;
  }

  // 生成坐标文本 (如 D4, Q16)
  function coordToText(row, col, size) {
    const letters = 'ABCDEFGHJKLMNOPQRST'; // 围棋中跳过 I
    return letters[col] + (size - row);
  }

  return {
    neighbors, getGroup, isLegalMove, placeStone,
    getLegalMoves, calculateScore, hasLegalMoves, coordToText,
    EMPTY, BLACK, WHITE, STAR_POINTS,
  };
})();


// ==================== BoardRenderer ====================
const BoardRenderer = (() => {
  'use strict';

  const { SIZE, CELL, PAD, STONE_R, WIDTH } = CONFIG;
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');

  // 颜色
  const C = {
    boardBg: '#dcb35c',
    boardLine: '#1a1005',
    starColor: '#1a1005',
    blackStone: '#111',
    whiteStone: '#f5f5f0',
    lastMove: '#e94560',
    hoverColor: 'rgba(233, 69, 96, 0.3)',
    territoryBlack: 'rgba(0,0,0,0.25)',
    territoryWhite: 'rgba(255,255,255,0.35)',
  };

  let hoverPos = null;   // [row, col] or null
  let lastMove = null;   // [row, col] or null
  let territoryMap = null; // 2D array: 0=neutral, BLACK, WHITE

  // 坐标转换
  function gridToXY(row, col) {
    return { x: PAD + col * CELL, y: PAD + row * CELL };
  }

  function xyToGrid(x, y) {
    const col = Math.round((x - PAD) / CELL);
    const row = Math.round((y - PAD) / CELL);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
    const { x: gx, y: gy } = gridToXY(row, col);
    if (Math.hypot(x - gx, y - gy) > CELL * 0.45) return null;
    return { row, col };
  }

  function eventToGrid(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;
    return xyToGrid(x, y);
  }

  // 绘制
  function render(board) {
    ctx.clearRect(0, 0, WIDTH, WIDTH);
    drawBoard();
    drawTerritory();
    drawStones(board);
    drawHover(board);
    drawLastMove();
    drawCoords();
  }

  function drawBoard() {
    // 棋盘底色
    ctx.fillStyle = C.boardBg;
    ctx.fillRect(0, 0, WIDTH, WIDTH);

    // 木纹质感
    ctx.save();
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < WIDTH; i += 3) {
      ctx.fillStyle = i % 6 === 0 ? '#8B6914' : '#C4A24E';
      ctx.fillRect(0, i, WIDTH, 1);
    }
    ctx.restore();

    // 网格线
    ctx.strokeStyle = C.boardLine;
    ctx.lineWidth = 1;
    for (let i = 0; i < SIZE; i++) {
      // 横线
      ctx.beginPath();
      ctx.moveTo(PAD, PAD + i * CELL);
      ctx.lineTo(PAD + (SIZE - 1) * CELL, PAD + i * CELL);
      ctx.stroke();
      // 竖线
      ctx.beginPath();
      ctx.moveTo(PAD + i * CELL, PAD);
      ctx.lineTo(PAD + i * CELL, PAD + (SIZE - 1) * CELL);
      ctx.stroke();
    }

    // 边框加粗
    ctx.lineWidth = 2;
    ctx.strokeRect(PAD, PAD, (SIZE - 1) * CELL, (SIZE - 1) * CELL);

    // 星位
    for (const [r, c] of STAR_POINTS) {
      const { x, y } = gridToXY(r, c);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = C.starColor;
      ctx.fill();
    }
  }

  function drawStones(board) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] !== EMPTY) {
          drawStone(r, c, board[r][c]);
        }
      }
    }
  }

  function drawStone(row, col, color) {
    const { x, y } = gridToXY(row, col);
    const r = STONE_R;

    // 阴影
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // 棋子主体
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);

    if (color === BLACK) {
      const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      grad.addColorStop(0, '#555');
      grad.addColorStop(1, '#111');
      ctx.fillStyle = grad;
    } else {
      const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(1, '#ccc');
      ctx.fillStyle = grad;
    }
    ctx.fill();
    ctx.restore();

    // 棋子边缘
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color === BLACK ? '#000' : '#aaa';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  function drawLastMove() {
    if (!lastMove) return;
    const { x, y } = gridToXY(lastMove[0], lastMove[1]);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = C.lastMove;
    ctx.fill();
  }

  function drawHover(board) {
    if (!hoverPos) return;
    const [row, col] = hoverPos;
    if (board[row][col] !== EMPTY) return;
    const { x, y } = gridToXY(row, col);
    ctx.beginPath();
    ctx.arc(x, y, STONE_R, 0, Math.PI * 2);
    ctx.fillStyle = C.hoverColor;
    ctx.fill();
  }

  function drawCoords() {
    ctx.fillStyle = '#5a4520';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const letters = 'ABCDEFGHJKLMNOPQRST';
    for (let i = 0; i < SIZE; i++) {
      // 上方字母
      ctx.fillText(letters[i], PAD + i * CELL, PAD - 16);
      // 左侧数字
      ctx.fillText(SIZE - i, PAD - 18, PAD + i * CELL);
    }
  }

  function drawTerritory() {
    if (!territoryMap) return;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (territoryMap[r][c] !== EMPTY) {
          const { x, y } = gridToXY(r, c);
          ctx.beginPath();
          ctx.rect(x - CELL * 0.3, y - CELL * 0.3, CELL * 0.6, CELL * 0.6);
          ctx.fillStyle = territoryMap[r][c] === BLACK ? C.territoryBlack : C.territoryWhite;
          ctx.fill();
        }
      }
    }
  }

  function setHover(pos) { hoverPos = pos; }
  function setLastMove(pos) { lastMove = pos; }
  function setTerritory(map) { territoryMap = map; }

  return { render, eventToGrid, setHover, setLastMove, setTerritory, gridToXY };
})();


// ==================== Toast ====================
function _showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.className = 'toast', 2000);
}


// ==================== TimerUI ====================
const TimerUI = (() => {
  const arc = document.getElementById('timerArc');
  const num = document.getElementById('timerNum');
  const card = document.getElementById('timerCard');
  const circumference = 2 * Math.PI * 34;
  let _timer = null;

  function show() { card && (card.style.display = ''); }
  function hide() { card && (card.style.display = 'none'); }

  function start(deadlineMs, onTimeout) {
    if (arc) arc.style.strokeDasharray = circumference;
    stop();

    function tick() {
      const remain = (deadlineMs - Date.now()) / 1000;
      if (remain <= 0) { stop(); if (onTimeout) onTimeout(); return; }
      if (num) num.textContent = Math.ceil(remain);
      if (arc) {
        const offset = circumference * (1 - remain / CONFIG.TURN_SECS);
        arc.style.strokeDashoffset = offset;
        arc.classList.toggle('urgent', remain <= 5);
      }
      _timer = requestAnimationFrame(tick);
    }
    tick();
  }

  function stop() {
    if (_timer) { cancelAnimationFrame(_timer); _timer = null; }
  }

  return { show, hide, start, stop };
})();


// ==================== Audio ====================
let _audioCtx = null;
function _getAudio() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
function _playPlace() {
  try {
    const a = _getAudio(), t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination);
    o.type = 'sine'; o.frequency.setValueAtTime(800, t);
    o.frequency.exponentialRampToValueAtTime(400, t + 0.06);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.start(t); o.stop(t + 0.12);
  } catch(e) {}
}
function _playCapture() {
  try {
    const a = _getAudio(), t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination);
    o.type = 'triangle'; o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.15);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.start(t); o.stop(t + 0.2);
  } catch(e) {}
}
function _playWin() {
  try {
    const a = _getAudio(), t = a.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.connect(g); g.connect(a.destination);
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.15, t + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.3);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.3);
    });
  } catch(e) {}
}


// ==================== Modal ====================
function showModal(winner, reason, score) {
  const overlay = document.getElementById('modalOverlay');
  const icon = document.getElementById('modalIcon');
  const title = document.getElementById('modalTitle');
  const desc = document.getElementById('modalDesc');
  const btnGroup = document.getElementById('modalBtnGroup');

  const isBlack = winner === GoLogic.BLACK;
  icon.textContent = isBlack ? '⚫' : '⚪';

  if (reason === 'timeout') {
    title.textContent = (isBlack ? '黑方' : '白方') + '获胜！';
    desc.textContent = '对方超时判负';
  } else if (reason === 'disconnect') {
    title.textContent = '对手离开了';
    desc.textContent = '';
  } else if (reason === 'draw') {
    title.textContent = '和棋';
    desc.textContent = '双方握手言和';
  } else {
    // 正常终局（数目）
    title.textContent = (isBlack ? '黑方' : '白方') + '获胜！';
    if (score) {
      desc.textContent =
        '黑 ' + score.black.toFixed(1) + ' vs 白 ' + score.white.toFixed(1) +
        '（贴目 ' + CONFIG.KOMI + '）';
    } else {
      desc.textContent = '对方认输';
    }
  }

  let html = '';
  if (OnlineGame.isActive()) {
    html = '<button class="btn btn-primary" onclick="OnlineGame.requestRematch()">再来一局</button>' +
           '<button class="btn btn-secondary" onclick="OnlineGame.leave()">离开房间</button>';
  } else {
    html = '<button class="btn btn-primary" onclick="hideModal();LocalGame.restart()">再来一局</button>' +
           '<button class="btn btn-secondary" onclick="hideModal();App.showLobby()">返回大厅</button>';
  }
  btnGroup.innerHTML = html;
  overlay.classList.add('show');
}

function hideModal() {
  document.getElementById('modalOverlay').classList.remove('show');
}


// ==================== LocalGame ====================
const LocalGame = (() => {
  'use strict';
  const SIZE = CONFIG.SIZE;
  let board, current, over, history, capturedCount, consecutivePasses, koPoint, lastMovePos;
  // history: [{ action:'place'|'pass', row, col, color, captured:[], koPoint }]

  function reset() {
    board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    current = BLACK;
    over = false;
    history = [];
    capturedCount = { [BLACK]: 0, [WHITE]: 0 }; // 各方提子数
    consecutivePasses = 0;
    koPoint = null;
    lastMovePos = null;
    BoardRenderer.setLastMove(null);
    BoardRenderer.setTerritory(null);
    BoardRenderer.setHover(null);
  }

  // 落子，返回 { ok, captured, koPoint, pass, notation, endGame, score }
  function place(row, col) {
    if (over) return { ok: false };
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return { ok: false };
    if (!GoLogic.isLegalMove(board, row, col, current, SIZE, koPoint)) return { ok: false };

    const result = GoLogic.placeStone(board, row, col, current, SIZE, koPoint);
    const notation = GoLogic.coordToText(row, col, SIZE);
    const captured = result.captured;

    history.push({
      action: 'place', row, col, color: current,
      captured: captured.map(c => [...c]),
      prevKo: koPoint,
    });

    // 更新提子数
    const opp = current === BLACK ? WHITE : BLACK;
    capturedCount[current] += captured.length;

    board = result.board;
    koPoint = result.koPoint;
    lastMovePos = [row, col];
    consecutivePasses = 0;
    BoardRenderer.setLastMove(lastMovePos);

    if (captured.length > 0) _playCapture(); else _playPlace();

    // 切换
    current = opp;
    return { ok: true, captured, notation };
  }

  // 虚手（PASS）
  function pass() {
    if (over) return { ok: false };
    history.push({ action: 'pass', color: current, prevKo: koPoint });
    consecutivePasses++;
    koPoint = null;
    current = current === BLACK ? WHITE : BLACK;

    if (consecutivePasses >= CONFIG.PASS_COUNT_TO_END) {
      over = true;
      const score = GoLogic.calculateScore(board, SIZE, CONFIG.KOMI);
      _showTerritory(score);
      return { ok: true, pass: true, endGame: true, score, winner: score.winner };
    }
    return { ok: true, pass: true };
  }

  // 认输
  function resign() {
    if (over) return;
    over = true;
    const winner = current === BLACK ? WHITE : BLACK;
    return { ok: true, resign: true, winner };
  }

  function undo() {
    if (history.length === 0 || over) return false;
    const last = history.pop();
    if (last.action === 'place') {
      board[last.row][last.col] = EMPTY;
      for (const [cr, cc] of last.captured) {
        board[cr][cc] = last.color === BLACK ? WHITE : BLACK;
      }
      capturedCount[last.color] -= last.captured.length;
      koPoint = last.prevKo;
      current = last.color;
      // 恢复 lastMove
      if (history.length > 0) {
        const prev = history[history.length - 1];
        if (prev.action === 'place') lastMovePos = [prev.row, prev.col];
        else lastMovePos = null;
      } else {
        lastMovePos = null;
      }
      BoardRenderer.setLastMove(lastMovePos);
    } else if (last.action === 'pass') {
      current = last.color;
      koPoint = last.prevKo;
      consecutivePasses = Math.max(0, consecutivePasses - 1);
    }
    return true;
  }

  function _showTerritory(score) {
    // 构建地域标记图
    const visited = new Set();
    const map = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === EMPTY && !visited.has(r * SIZE + c)) {
          const region = [];
          const borders = new Set();
          const stack = [[r, c]];
          while (stack.length > 0) {
            const [cr, cc] = stack.pop();
            const key = cr * SIZE + cc;
            if (visited.has(key)) continue;
            visited.add(key);
            region.push([cr, cc]);
            for (const [nr, nc] of GoLogic.neighbors(cr, cc, SIZE)) {
              if (board[nr][nc] === EMPTY) {
                if (!visited.has(nr * SIZE + nc)) stack.push([nr, nc]);
              } else {
                borders.add(board[nr][nc]);
              }
            }
          }
          if (borders.size === 1) {
            const owner = borders.values().next().value;
            for (const [rr, rc] of region) map[rr][rc] = owner;
          }
        }
      }
    }
    BoardRenderer.setTerritory(map);
  }

  function getBoard() { return board; }
  function getCurrent() { return current; }
  function isOver() { return over; }
  function getHistory() { return history; }
  function getCapturedCount() { return capturedCount; }

  reset();
  return { reset, place, pass, resign, undo, getBoard, getCurrent, isOver, getHistory, getCapturedCount };
})();


// ==================== OnlineGame ====================
const OnlineGame = (() => {
  'use strict';
  let ws = null;
  let myColor = null;
  let roomId = null;
  let myName = '';
  let gameActive = false;
  let scores = {};     // name -> count
  let roundNum = 1;

  // 远程棋盘状态（由服务端驱动）
  let board, current, over, koPoint, lastMovePos;
  let capturedCount;
  let consecutivePasses = 0;
  const SIZE = CONFIG.SIZE;

  function init(b, c, mc, rn) {
    board = b; current = c; myColor = mc; roomId = rn;
    gameActive = true; over = false; koPoint = null; lastMovePos = null;
    capturedCount = { [BLACK]: 0, [WHITE]: 0 };
    consecutivePasses = 0;
    BoardRenderer.setLastMove(null);
    BoardRenderer.setTerritory(null);
  }

  function connect(url) {
    ws = new WebSocket(url);
    ws.onopen = () => {
      _showToast('已连接到服务器');
      if (roomId) {
        ws.send(JSON.stringify({ type: 'join', room: roomId, name: myName }));
      }
    };
    ws.onclose = () => {
      if (gameActive) {
        showModal(current === myColor ? (myColor === BLACK ? WHITE : BLACK) : myColor, 'disconnect');
        gameActive = false;
      }
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      _handleMsg(msg);
    };
  }

  function _handleMsg(msg) {
    switch (msg.type) {
      case 'joined':
        roomId = msg.room_id;
        myColor = msg.color;
        myName = document.getElementById('nameInput').value || '玩家';
        board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
        current = BLACK;
        over = false;
        koPoint = null;
        lastMovePos = null;
        consecutivePasses = 0;
        capturedCount = { [BLACK]: 0, [WHITE]: 0 };
        document.getElementById('app').style.display = '';
        document.getElementById('lobby').style.display = 'none';
        document.getElementById('roomLabel').textContent = '房间 ' + roomId + ' · 第 ' + roundNum + ' 局';
        _updateColorUI();
        _updateTurnUI();
        if (isMyTurn()) {
          TimerUI.show();
          TimerUI.start(Date.now() + CONFIG.TURN_SECS * 1000, _onTimeout);
        } else {
          TimerUI.hide();
        }
        _render();
        break;

      case 'opponent_joined':
        _showToast('对手已加入');
        if (!isMyTurn()) {
          TimerUI.hide();
        }
        break;

      case 'moved':
        // msg: { from:{row,col}, to:{row,col} 或 { row, col, color }, captured:[] }
        const mr = msg.row, mc2 = msg.col;
        if (mr !== undefined && mc2 !== undefined) {
          const color = msg.color || (current === BLACK ? WHITE : BLACK);
          const result = GoLogic.placeStone(board, mr, mc2, color, SIZE, koPoint);
          board = result.board;
          koPoint = result.koPoint;
          lastMovePos = [mr, mc2];
          consecutivePasses = 0;
          capturedCount[color] += (result.captured || []).length;
          if ((result.captured || []).length > 0) _playCapture(); else _playPlace();
        }
        current = current === BLACK ? WHITE : BLACK;
        _updateTurnUI();
        _render();
        // 轮到我
        if (isMyTurn()) {
          TimerUI.show();
          TimerUI.start(Date.now() + CONFIG.TURN_SECS * 1000, _onTimeout);
        } else {
          TimerUI.stop(); TimerUI.hide();
        }
        break;

      case 'passed':
        consecutivePasses++;
        koPoint = null;
        current = current === BLACK ? WHITE : BLACK;
        _showToast((msg.color === BLACK ? '黑方' : '白方') + '虚手');
        if (consecutivePasses >= CONFIG.PASS_COUNT_TO_END) {
          over = true;
          const score = GoLogic.calculateScore(board, SIZE, CONFIG.KOMI);
          // 构建地域标记
          _showTerritoryLocal(score);
          showModal(score.winner, 'score', score);
          _playWin();
          _render();
          return;
        }
        _updateTurnUI();
        _render();
        if (isMyTurn()) {
          TimerUI.show();
          TimerUI.start(Date.now() + CONFIG.TURN_SECS * 1000, _onTimeout);
        } else {
          TimerUI.stop(); TimerUI.hide();
        }
        break;

      case 'resigned':
        over = true;
        const rw = msg.winner;
        showModal(rw, 'resign');
        _playWin();
        break;

      case 'timeout':
        over = true;
        showModal(msg.winner, 'timeout');
        _playWin();
        TimerUI.stop(); TimerUI.hide();
        break;

      case 'over':
        if (msg.winner === 'draw') {
          over = true;
          showModal(null, 'draw');
        }
        break;

      case 'rematch_request':
        _showModal('rematch');
        break;

      case 'rematch_accepted':
        roundNum++;
        board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
        current = BLACK;
        over = false;
        koPoint = null;
        lastMovePos = null;
        consecutivePasses = 0;
        capturedCount = { [BLACK]: 0, [WHITE]: 0 };
        hideModal();
        _updateTurnUI();
        _render();
        document.getElementById('roomLabel').textContent = '房间 ' + roomId + ' · 第 ' + roundNum + ' 局';
        if (isMyTurn()) {
          TimerUI.show();
          TimerUI.start(Date.now() + CONFIG.TURN_SECS * 1000, _onTimeout);
        }
        break;

      case 'opponent_left':
        showModal(current, 'disconnect');
        gameActive = false;
        TimerUI.stop(); TimerUI.hide();
        break;

      case 'error':
        _showToast(msg.message || '操作失败');
        break;
    }
  }

  function _onTimeout() {
    over = true;
    const winner = current === BLACK ? WHITE : BLACK;
    // 通知服务端
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'timeout' }));
    }
    showModal(winner, 'timeout');
  }

  function _showTerritoryLocal(score) {
    const visited = new Set();
    const map = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === EMPTY && !visited.has(r * SIZE + c)) {
          const region = [];
          const borders = new Set();
          const stack = [[r, c]];
          while (stack.length > 0) {
            const [cr, cc] = stack.pop();
            const key = cr * SIZE + cc;
            if (visited.has(key)) continue;
            visited.add(key);
            region.push([cr, cc]);
            for (const [nr, nc] of GoLogic.neighbors(cr, cc, SIZE)) {
              if (board[nr][nc] === EMPTY) {
                if (!visited.has(nr * SIZE + nc)) stack.push([nr, nc]);
              } else {
                borders.add(board[nr][nc]);
              }
            }
          }
          if (borders.size === 1) {
            const owner = borders.values().next().value;
            for (const [rr, rc] of region) map[rr][rc] = owner;
          }
        }
      }
    }
    BoardRenderer.setTerritory(map);
  }

  function _updateColorUI() {
    const card = document.getElementById('myColorCard');
    const dot = document.getElementById('myColorDot');
    const name = document.getElementById('myColorName');
    card.style.display = 'flex';
    dot.className = 'color-dot ' + (myColor === BLACK ? 'black' : 'white');
    name.textContent = myColor === BLACK ? '黑棋' : '白棋';
  }

  function _updateTurnUI() {
    const dot = document.getElementById('turnDot');
    const text = document.getElementById('turnText');
    const ind = document.getElementById('turnIndicator');
    if (!dot || !text) return;
    dot.className = 'color-dot ' + (current === BLACK ? 'black' : 'white');
    text.textContent = (current === BLACK ? '黑方' : '白方') + '落子';
    if (isMyTurn()) {
      ind.className = 'turn-indicator my-turn';
    } else {
      ind.className = 'turn-indicator their-turn';
    }
    // 更新计分板名字
    const blackLabel = document.getElementById('blackNameLabel');
    const whiteLabel = document.getElementById('whiteNameLabel');
    const blackScore = document.getElementById('blackScore');
    const whiteScore = document.getElementById('whiteScore');
    if (blackLabel) blackLabel.textContent = myColor === BLACK ? myName + '(我)' : '黑方';
    if (whiteLabel) whiteLabel.textContent = myColor === WHITE ? myName + '(我)' : '白方';
    if (blackScore) blackScore.textContent = capturedCount[BLACK];
    if (whiteScore) whiteScore.textContent = capturedCount[WHITE];
  }

  function _render() {
    BoardRenderer.render(board);
  }

  function _showModal(type) {
    const overlay = document.getElementById('modalOverlay');
    const icon = document.getElementById('modalIcon');
    const title = document.getElementById('modalTitle');
    const desc = document.getElementById('modalDesc');
    const btnGroup = document.getElementById('modalBtnGroup');

    if (type === 'rematch') {
      icon.textContent = '🔄';
      title.textContent = '对方请求再来一局';
      desc.textContent = '';
      btnGroup.innerHTML =
        '<button class="btn btn-primary" onclick="OnlineGame.acceptRematch()">接受</button>' +
        '<button class="btn btn-secondary" onclick="OnlineGame.declineRematch()">拒绝</button>';
      overlay.classList.add('show');
    }
  }

  // 公开 API
  function isMyTurn() { return current === myColor; }
  function getBoard() { return board; }
  function isActive() { return gameActive && !over; }
  function isOver() { return over; }
  function getRoomId() { return roomId; }
  function getMyColor() { return myColor; }

  function doPlace(row, col) {
    if (over || !isMyTurn() || !ws) return;
    if (!GoLogic.isLegalMove(board, row, col, myColor, SIZE, koPoint)) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    TimerUI.stop();
    ws.send(JSON.stringify({ type: 'move', row, col }));
  }

  function doPass() {
    if (over || !isMyTurn() || !ws) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    TimerUI.stop();
    ws.send(JSON.stringify({ type: 'pass' }));
  }

  function doResign() {
    if (over || !ws) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    TimerUI.stop();
    ws.send(JSON.stringify({ type: 'resign' }));
  }

  function requestRematch() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'rematch_request' }));
    _showToast('已发送再战请求');
    hideModal();
  }

  function acceptRematch() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'rematch_accept' }));
    hideModal();
  }

  function declineRematch() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'rematch_decline' }));
    hideModal();
    showModal(current, 'end');
  }

  function leave() {
    gameActive = false;
    TimerUI.stop(); TimerUI.hide();
    if (ws) { ws.close(); ws = null; }
    hideModal();
    App.showLobby();
  }

  return {
    init, connect, isMyTurn, getBoard, isActive, isOver, getRoomId, getMyColor,
    doPlace, doPass, doResign, requestRematch, acceptRematch, declineRematch, leave,
  };
})();


// ==================== App ====================
const App = (() => {
  'use strict';
  let mode = null; // 'local' | 'online'

  const elLobby = document.getElementById('lobby');
  const elApp = document.getElementById('app');
  const elCanvas = document.getElementById('board');

  // --- Lobby Step Navigation ---
  function _showStep(id) {
    document.querySelectorAll('.lobby-step').forEach(el => el.style.display = 'none');
    document.getElementById(id).style.display = '';
  }

  // 按钮绑定
  document.getElementById('btnLocal').onclick = () => {
    mode = 'local';
    _startLocal();
  };
  document.getElementById('btnOnline').onclick = () => {
    _showStep('stepName');
    setTimeout(() => document.getElementById('nameInput').focus(), 100);
  };
  document.getElementById('btnBackFromName').onclick = () => _showStep('stepMode');
  document.getElementById('btnNameConfirm').onclick = _onNameConfirm;
  document.getElementById('nameInput').onkeydown = (e) => { if (e.key === 'Enter') _onNameConfirm(); };

  function _onNameConfirm() {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) { _showToast('请输入昵称'); return; }
    _showStep('stepOnline');
  }

  document.getElementById('btnBackMode').onclick = () => _showStep('stepName');
  document.getElementById('btnCreate').onclick = () => {
    const name = document.getElementById('nameInput').value.trim() || '玩家';
    OnlineGame.myName = name;
    _showStep('stepCreate');
    _createRoom();
  };
  document.getElementById('btnJoin').onclick = () => {
    _showStep('stepJoin');
    setTimeout(() => document.getElementById('roomInput').focus(), 100);
  };
  document.getElementById('btnBackOnline1').onclick = () => _showStep('stepOnline');
  document.getElementById('btnBackOnline2').onclick = () => _showStep('stepOnline');
  document.getElementById('btnJoinConfirm').onclick = _onJoinConfirm;
  document.getElementById('roomInput').onkeydown = (e) => { if (e.key === 'Enter') _onJoinConfirm(); };

  function _createRoom() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = protocol + '//' + location.host + '/ws-go';
    OnlineGame.connect(url);
  }

  function _onJoinConfirm() {
    const roomCode = document.getElementById('roomInput').value.trim();
    if (!roomCode) { _showToast('请输入房间号'); return; }
    const name = document.getElementById('nameInput').value.trim() || '玩家';
    OnlineGame.myName = name;
    OnlineGame.roomId = roomCode;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = protocol + '//' + location.host + '/ws-go';
    OnlineGame.connect(url);
  }

  // Copy room code
  document.getElementById('btnCopy').onclick = () => {
    const code = document.getElementById('roomCode').textContent;
    navigator.clipboard.writeText(code).then(() => _showToast('已复制')).catch(() => {});
  };

  // --- Local Game ---
  function _startLocal() {
    mode = 'local';
    LocalGame.reset();
    elLobby.style.display = 'none';
    elApp.style.display = '';
    document.getElementById('roomLabel').textContent = '';
    document.getElementById('myColorCard').style.display = 'none';
    document.getElementById('timerCard').style.display = 'none';
    document.getElementById('btnLeave').style.display = 'none';
    document.getElementById('roundInfo').style.display = 'none';
    document.getElementById('blackNameLabel').textContent = '黑方';
    document.getElementById('whiteNameLabel').textContent = '白方';
    _updateLocalUI();
    _renderLocal();
  }

  function _updateLocalUI() {
    const dot = document.getElementById('turnDot');
    const text = document.getElementById('turnText');
    const ind = document.getElementById('turnIndicator');
    const cur = LocalGame.getCurrent();
    dot.className = 'color-dot ' + (cur === GoLogic.BLACK ? 'black' : 'white');
    text.textContent = (cur === GoLogic.BLACK ? '黑方' : '白方') + '落子';
    ind.className = 'turn-indicator my-turn';
    const cc = LocalGame.getCapturedCount();
    document.getElementById('blackScore').textContent = cc[GoLogic.BLACK];
    document.getElementById('whiteScore').textContent = cc[GoLogic.WHITE];
    _updateHistory();
  }

  function _updateHistory() {
    const list = document.getElementById('historyList');
    const hist = LocalGame.getHistory();
    if (!list || hist.length === 0) { list.innerHTML = ''; return; }
    let html = '';
    hist.forEach((h, i) => {
      const colorClass = h.color === GoLogic.BLACK ? 'black' : 'white';
      const text = h.action === 'pass' ? 'Pass' : GoLogic.coordToText(h.row, h.col, CONFIG.SIZE);
      html += '<li class="history-item"><span class="history-dot ' + colorClass + '"></span>' +
              '<span>' + (i + 1) + '. ' + text + '</span></li>';
    });
    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
  }

  function _renderLocal() {
    BoardRenderer.render(LocalGame.getBoard());
  }

  // Canvas click — local mode
  elCanvas.onclick = (e) => {
    if (mode !== 'local') return;
    if (LocalGame.isOver()) return;
    const g = BoardRenderer.eventToGrid(e);
    if (!g) return;
    if (LocalGame.getBoard()[g.row][g.col] !== EMPTY) {
      _showToast('此处已有棋子');
      return;
    }
    const result = LocalGame.place(g.row, g.col);
    if (!result.ok) return;
    _updateLocalUI();
    _renderLocal();

    if (result.endGame) {
      showModal(result.score.winner, 'score', result.score);
      _playWin();
    }
  };

  // Canvas hover
  elCanvas.onmousemove = (e) => {
    const g = BoardRenderer.eventToGrid(e);
    BoardRenderer.setHover(g ? [g.row, g.col] : null);
    if (mode === 'local') _renderLocal();
    else if (OnlineGame.isActive()) BoardRenderer.render(OnlineGame.getBoard());
  };
  elCanvas.onmouseleave = () => {
    BoardRenderer.setHover(null);
    if (mode === 'local') _renderLocal();
    else if (OnlineGame.isActive()) BoardRenderer.render(OnlineGame.getBoard());
  };

  // Canvas click — online mode
  // 需要覆盖上面的 onclick，用统一处理
  elCanvas.onclick = (e) => {
    if (mode === 'local') {
      if (LocalGame.isOver()) return;
      const g = BoardRenderer.eventToGrid(e);
      if (!g) return;
      if (LocalGame.getBoard()[g.row][g.col] !== EMPTY) { _showToast('此处已有棋子'); return; }
      const result = LocalGame.place(g.row, g.col);
      if (!result.ok) return;
      _updateLocalUI();
      _renderLocal();
      if (result.endGame) { showModal(result.score.winner, 'score', result.score); _playWin(); }
    } else if (mode === 'online') {
      if (OnlineGame.isOver()) return;
      if (!OnlineGame.isMyTurn()) { _showToast('还不到你的回合'); return; }
      const g = BoardRenderer.eventToGrid(e);
      if (!g) return;
      OnlineGame.doPlace(g.row, g.col);
    }
  };

  // Action buttons
  document.getElementById('btnRestart').onclick = () => {
    if (mode === 'local') {
      LocalGame.reset();
      _updateLocalUI();
      _renderLocal();
      _showToast('已重新开始');
    }
  };

  document.getElementById('btnUndo').onclick = () => {
    if (mode === 'local') {
      if (LocalGame.undo()) {
        _updateLocalUI();
        _renderLocal();
      } else {
        _showToast('无法悔棋');
      }
    }
  };

  document.getElementById('btnLeave').onclick = () => {
    if (mode === 'online') OnlineGame.leave();
  };

  document.getElementById('btnBackLobby').onclick = () => {
    showLobby();
  };

  // Pass button
  document.getElementById('btnPass').onclick = () => {
    if (mode === 'local') {
      const result = LocalGame.pass();
      if (result.ok) {
        _showToast((LocalGame.getCurrent() === GoLogic.BLACK ? '黑方' : '白方') + '之前虚手了');
        _updateLocalUI();
        _renderLocal();
        if (result.endGame) { showModal(result.score.winner, 'score', result.score); _playWin(); }
      }
    } else if (mode === 'online') {
      OnlineGame.doPass();
    }
  };

  // Resign button
  document.getElementById('btnResign').onclick = () => {
    if (mode === 'local') {
      if (LocalGame.isOver()) return;
      const result = LocalGame.resign();
      if (result && result.ok) {
        showModal(result.winner, 'resign');
      }
    } else if (mode === 'online') {
      OnlineGame.doResign();
    }
  };

  function showLobby() {
    mode = null;
    elLobby.style.display = '';
    elApp.style.display = 'none';
    _showStep('stepMode');
    if (OnlineGame.isActive()) OnlineGame.leave();
    TimerUI.stop(); TimerUI.hide();
    LocalGame.reset();
    // 清空历史
    const list = document.getElementById('historyList');
    if (list) list.innerHTML = '';
  }

  // 公开
  function getMode() { return mode; }

  return { showLobby, getMode };
})();

// 初始渲染大厅
BoardRenderer.render(LocalGame.getBoard());
