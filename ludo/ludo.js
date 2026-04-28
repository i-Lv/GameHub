/* ============================================================
   飞行棋 (Ludo) · 完整实现
   ============================================================
   支持两种模式：
   - 本地对战：2-4人同一设备轮流操作
   - 联机对战：WebSocket房间制，不足4人AI补位

   规则：
   - 4色 × 4棋子，骰子1-6
   - 掷6起飞，起飞后可再投一次
   - 掷6且无可动棋子，再投一次
   - 落在对方棋子上→对方回家（安全格除外）
   - 走完大圈进入彩虹道，抵达终点算完成
   - 4颗棋子全到终点获胜
   ============================================================ */

'use strict';

// ─── 常量 ───────────────────────────────────────────────────
const COLORS = ['red', 'blue', 'green', 'yellow'];
const COLOR_HEX = { red:'#e74c3c', blue:'#2980b9', green:'#27ae60', yellow:'#f39c12' };
const COLOR_LIGHT = { red:'#ff8a80', blue:'#82b1ff', green:'#69f0ae', yellow:'#ffd740' };
const COLOR_DARK  = { red:'#b71c1c', blue:'#0d47a1', green:'#1b5e20', yellow:'#e65100' };
const COLOR_NAME  = { red:'红色', blue:'蓝色', green:'绿色', yellow:'黄色' };

// 大圈路径52格，各颜色起飞格索引
const START_IDX = { red:0, blue:13, green:26, yellow:39 };
// 各颜色进入彩虹道前最后大圈格（走完这格后进入彩虹道）
const ENTRY_BEFORE = { red:51, blue:12, green:25, yellow:38 };
// 安全格（各色起飞格 + 各色起飞格后第8格）
const SAFE_SET = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
// 彩虹道长度
const RAINBOW_LEN = 6;

// 骰子点数位置映射（3x3 grid，index 0-8）
// 0=左上 1=上中 2=右上 3=左中 4=中心 5=右中 6=左下 7=下中 8=右下
const DICE_DOTS = {
  0: [],                           // 无（未摇）
  1: [4],                          // 中心
  2: [2, 6],                       // 右上、左下
  3: [2, 4, 6],                    // 右上、中心、左下
  4: [0, 2, 6, 8],                 // 四角
  5: [0, 2, 4, 6, 8],             // 四角+中心
  6: [0, 2, 3, 5, 6, 8],          // 左列+右列
};

// ─── 棋盘坐标（15×15 网格）──────────────────────────────────
//
// 家区 6×6：红(左上 col0-5,row0-5), 蓝(右上 col9-14,row0-5)
//            绿(右下 col9-14,row9-14), 黄(左下 col0-5,row9-14)
// 十字走廊：col6/col8（竖廊），row6/row8（横廊）
// col7/row7 留给彩虹道，终点 (7,7)
//
// 52格顺时针路径，每段13格：
//   红段 pos0-12  ：左外圈↓ + 底横廊→ + 左下竖廊↓
//   蓝段 pos13-25 ：底外圈→ + 右下竖廊↑ + 底横廊右→
//   绿段 pos26-38 ：右外圈↑ + 顶横廊←
//   黄段 pos39-51 ：顶左竖廊↓ + 左横廊←
// 注：同一坐标格可被不同pos映射（如(1,6)被pos0和pos48共用），
// 游戏逻辑通过pos值判断，不通过坐标。
const MAIN_PATH = [
  // ── 红段 pos0-12（13格）──
  [1,6],  // 0  红起飞★
  [1,7],  // 1
  [1,8],  // 2
  [2,8],  // 3
  [3,8],  // 4
  [4,8],  // 5
  [5,8],  // 6
  [6,8],  // 7
  [6,9],  // 8  安全格(红+8)
  [6,10], // 9
  [6,11], // 10
  [6,12], // 11
  [6,13], // 12

  // ── 蓝段 pos13-25（13格）──
  [7,13], // 13 蓝起飞★
  [8,13], // 14
  [8,12], // 15
  [8,11], // 16
  [8,10], // 17
  [8,9],  // 18
  [8,8],  // 19
  [9,8],  // 20
  [10,8], // 21 安全格(蓝+8)
  [11,8], // 22
  [12,8], // 23
  [13,8], // 24
  [13,7], // 25

  // ── 绿段 pos26-38（13格）──
  [13,6], // 26 绿起飞★
  [13,5], // 27
  [13,4], // 28
  [13,3], // 29
  [13,2], // 30
  [13,1], // 31
  [12,1], // 32
  [11,1], // 33
  [10,1], // 34 安全格(绿+8)
  [9,1],  // 35
  [8,1],  // 36
  [7,1],  // 37
  [6,1],  // 38

  // ── 黄段 pos39-51（13格）──
  [6,2],  // 39 黄起飞★
  [6,3],  // 40
  [6,4],  // 41
  [6,5],  // 42
  [6,6],  // 43
  [5,6],  // 44
  [4,6],  // 45
  [3,6],  // 46
  [2,6],  // 47 安全格(黄+8)
  [1,6],  // 48（与红pos0坐标相同，但pos值不同，逻辑上是黄色棋子路过红起飞格旁边）
  [1,5],  // 49
  [1,4],  // 50
  [1,3],  // 51（走完此格后，红色棋子下一步进入彩虹道）
];
// 合计52格（pos0-51）✓

// 各颜色彩虹道（进入家门后6格到终点(7,7)）
// 注：ENTRY_BEFORE[color]格走完后，下一步进入rainbow[0]
const RAINBOW_PATH = {
  red:    [[2,7],[3,7],[4,7],[5,7],[6,7],[7,7]],   // 从左侧进入 →
  blue:   [[7,12],[7,11],[7,10],[7,9],[7,8],[7,7]], // 从下方进入 ↑
  green:  [[12,7],[11,7],[10,7],[9,7],[8,7],[7,7]], // 从右侧进入 ←
  yellow: [[7,2],[7,3],[7,4],[7,5],[7,6],[7,7]],   // 从上方进入 ↓
};

// 家区停机坪（每色4个）
const HOME_SPOTS = {
  red:    [[2,2],[4,2],[2,4],[4,4]],
  blue:   [[10,2],[12,2],[10,4],[12,4]],
  green:  [[10,10],[12,10],[10,12],[12,12]],
  yellow: [[2,10],[4,10],[2,12],[4,12]],
};

// ─── 全局状态 ──────────────────────────────────────────────────
let G = null;          // 游戏状态对象
let config = {};       // 玩家配置 {color: 'human'|'ai'}
let animating = false;

// 联机相关
let ws = null;         // WebSocket连接
let myColor = null;    // 联机时自己的颜色
let roomId = null;     // 房间号
let myName = '';       // 昵称
let onlineMode = false;
let expectedPlayers = 4;

// Canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let CS = 40;
let OFFSET_X = 0, OFFSET_Y = 0;

// ─── 界面切换 ─────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── 菜单交互 ─────────────────────────────────────────────────

// 模式Tab切换
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.mode;
    document.getElementById('localSetup').style.display = mode === 'local' ? 'block' : 'none';
    document.getElementById('onlineSetup').style.display = mode === 'online' ? 'block' : 'none';
  });
});

// 人数选择（联机）
document.querySelectorAll('.online-count').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.online-count').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ─── 本地游戏 ──────────────────────────────────────────────────

function startLocalGame() {
  onlineMode = false;
  ws = null;

  // 本地模式固定4人全部为人类玩家
  config = {};
  COLORS.forEach(c => {
    config[c] = 'human';
  });

  if (!createGame()) return;
  showScreen('gameScreen');
  resizeCanvas();
  renderAll();
  updateUI();
}

document.getElementById('localStartBtn').addEventListener('click', startLocalGame);

// ─── 联机交互 ──────────────────────────────────────────────────

document.getElementById('createRoomBtn').addEventListener('click', () => {
  const name = document.getElementById('nicknameInput').value.trim();
  if (name.length < 2) { showToast('请输入至少2字的昵称'); return; }
  myName = name;
  expectedPlayers = parseInt(document.querySelector('.online-count.active').dataset.count);
  createOnlineRoom();
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
  const name = document.getElementById('nicknameInput').value.trim();
  if (name.length < 2) { showToast('请输入至少2字的昵称'); return; }
  myName = name;
  expectedPlayers = parseInt(document.querySelector('.online-count.active').dataset.count);
  document.getElementById('joinDialog').style.display = 'block';
  document.getElementById('roomInput').value = '';
  document.getElementById('roomInput').focus();
});

document.getElementById('cancelJoinBtn').addEventListener('click', () => {
  document.getElementById('joinDialog').style.display = 'none';
});

document.getElementById('confirmJoinBtn').addEventListener('click', () => {
  const rid = document.getElementById('roomInput').value.trim();
  if (!rid) { showToast('请输入房间号'); return; }
  document.getElementById('joinDialog').style.display = 'none';
  joinOnlineRoom(rid);
});

document.getElementById('copyRoomBtn').addEventListener('click', () => {
  if (!roomId) return;
  navigator.clipboard.writeText(roomId).then(() => showToast('已复制房间号')).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = roomId; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    showToast('已复制房间号');
  });
});

document.getElementById('lobbyLeaveBtn').addEventListener('click', () => {
  if (ws) { ws.close(); ws = null; }
  roomId = null;
  showScreen('menuScreen');
});

// WebSocket连接
function connectWS(url) {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(protocol + '//' + location.host + url);
    socket.onopen = () => resolve(socket);
    socket.onerror = (e) => reject(e);
    socket.onclose = () => { if (onlineMode) showToast('连接断开'); };
  });
}

async function createOnlineRoom() {
  try {
    onlineMode = true;
    ws = await connectWS('/ws-ludo');
    ws.onmessage = handleWSMessage;

    roomId = genRoomId();
    wsSend({ type:'create', room:roomId, name:myName, max_players:expectedPlayers });
    showScreen('lobbyScreen');
    document.getElementById('lobbyRoomId').textContent = roomId;
  } catch(e) {
    showToast('连接服务器失败，请稍后重试');
    onlineMode = false;
  }
}

async function joinOnlineRoom(rid) {
  try {
    onlineMode = true;
    ws = await connectWS('/ws-ludo');
    ws.onmessage = handleWSMessage;

    roomId = rid;
    wsSend({ type:'join', room:rid, name:myName });
    showScreen('lobbyScreen');
    document.getElementById('lobbyRoomId').textContent = rid;
  } catch(e) {
    showToast('连接服务器失败，请稍后重试');
    onlineMode = false;
  }
}

function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// WebSocket消息处理
function handleWSMessage(e) {
  const msg = JSON.parse(e.data);
  switch(msg.type) {
    case 'waiting':
      // 创建者等待
      updateLobbyUI(msg);
      break;
    case 'lobby':
      // 大厅状态更新
      updateLobbyUI(msg);
      break;
    case 'start':
      // 游戏开始
      startOnlineGame(msg);
      break;
    case 'dice':
      // 有人摇骰子
      onRemoteDice(msg);
      break;
    case 'move':
      // 有人移动棋子
      onRemoteMove(msg);
      break;
    case 'turn':
      // 回合切换
      onRemoteTurn(msg);
      break;
    case 'over':
      // 游戏结束
      onRemoteOver(msg);
      break;
    case 'error':
      showToast(msg.msg);
      break;
    case 'opponent_left':
      showToast('有玩家离开了房间');
      break;
  }
}

function updateLobbyUI(msg) {
  const el = document.getElementById('lobbyPlayers');
  let html = '';
  (msg.players || []).forEach(p => {
    const isMe = p.color === myColor || (msg.my_color && p.color === msg.my_color);
    const isAI = p.type === 'ai';
    html += `<div class="lobby-player-card ${isAI?'ai-card':''}">
      <div class="lp-color" style="background:${COLOR_HEX[p.color]}"></div>
      <div class="lp-name">${p.name}${isMe?' (你)':''}</div>
      <div class="lp-tag">${isAI?'🤖 电脑':'👤 玩家'}</div>
    </div>`;
  });
  el.innerHTML = html;

  const total = msg.max_players || 4;
  const joined = msg.players ? msg.players.length : 0;
  document.getElementById('lobbyHint').textContent =
    joined < total ? `等待其他玩家加入（${joined}/${total}）...` : '所有玩家已就绪！';

  // 如果是房主且人已满，显示开始按钮
  if (joined >= total) {
    document.getElementById('lobbyStartBtn').style.display = 'block';
  } else {
    document.getElementById('lobbyStartBtn').style.display = 'none';
  }
}

document.getElementById('lobbyStartBtn').addEventListener('click', () => {
  wsSend({ type:'start_game' });
});

function startOnlineGame(msg) {
  myColor = msg.my_color;
  config = {};
  // 标记AI和人类
  (msg.player_types || []).forEach(pt => {
    config[pt.color] = pt.type === 'ai' ? 'ai' : 'human';
  });

  // 初始化游戏状态
  G = {
    players: COLORS.filter(c => config[c] !== 'off'),
    pieces: {},
    turn: 0,
    dice: 0,
    rolled: false,
    movable: [],
    finished: [],
    winner: null,
  };
  COLORS.forEach(color => {
    G.pieces[color] = [0,1,2,3].map(i => ({ id:i, pos:-1, rainbow:0 }));
  });

  showScreen('gameScreen');
  resizeCanvas();
  renderAll();
  updateUI();
  showToast(`你是${COLOR_NAME[myColor]}，游戏开始！`);
}

// ─── 联机游戏操作 ──────────────────────────────────────────────

function onRemoteDice(msg) {
  G.dice = msg.value;
  G.rolled = true;
  setDiceFace(G.dice);
  document.getElementById('dice').classList.add('rolling');
  setTimeout(() => document.getElementById('dice').classList.remove('rolling'), 500);

  const color = msg.color;
  G.movable = getMovablePieces(color, G.dice);
  updateUI();
  renderAll();

  // 如果是人类且是自己的回合，等待点击
  // 如果是AI，AI的移动由服务端自动发送
  if (G.movable.length === 0) {
    // 无可动棋子，等服务端处理
  }
}

function onRemoteMove(msg) {
  const { color, piece_idx, pos, rainbow } = msg;
  const piece = G.pieces[color][piece_idx];
  piece.pos = pos;
  piece.rainbow = rainbow;

  // 如果有被击退
  if (msg.kicked && msg.kicked.length > 0) {
    msg.kicked.forEach(k => {
      const kp = G.pieces[k.color][k.piece_idx];
      if (kp) { kp.pos = -1; kp.rainbow = 0; }
      showToast(`${COLOR_NAME[color]} 击退了 ${COLOR_NAME[k.color]}！`);
    });
  }

  if (msg.finished) {
    showToast(`${COLOR_NAME[color]} 送回一颗棋子到终点！`);
  }

  G.rolled = false;
  G.movable = [];
  G.dice = 0;
  setDiceFace(0);
  renderAll();
  checkWin(color);
}

function onRemoteTurn(msg) {
  G.turn = COLORS.indexOf(msg.color);
  G.rolled = false;
  G.movable = [];
  G.dice = 0;
  updateUI();
  renderAll();
}

function onRemoteOver(msg) {
  if (msg.winner) {
    showWin(msg.winner);
  }
}

// ─── 游戏核心（本地和联机共用）───────────────────────────────

function createGame() {
  const activePlayers = COLORS.filter(c => config[c] !== 'off');
  if (activePlayers.length < 2) { showToast('至少需要2名玩家！'); return false; }

  G = {
    players: activePlayers,
    pieces: {},
    turn: 0,
    dice: 0,
    rolled: false,
    movable: [],
    extraRoll: false,
    finished: [],
    winner: null,
  };

  activePlayers.forEach(color => {
    G.pieces[color] = [0,1,2,3].map(i => ({ id:i, pos:-1, rainbow:0 }));
  });

  return true;
}

// ─── 路径和位置 ──────────────────────────────────────────────

function currentColor() { return G.players[G.turn]; }

function stepsFromStart(color, pos) {
  const start = START_IDX[color];
  let d = pos - start;
  if (d < 0) d += 52;
  return d;
}

// 移动棋子，返回新状态 {pos, rainbow, events:[]}
function movePiece(color, piece, steps) {
  const events = [];
  let { pos, rainbow } = piece;
  const N = 52;
  const entryAt = ENTRY_BEFORE[color];

  if (pos === -1) {
    if (steps !== 6) return null;
    const startPos = START_IDX[color];
    pos = startPos;
    rainbow = 0;
    events.push('launch');
    return { pos, rainbow, events };
  }

  if (rainbow > 0) {
    const newR = rainbow + steps;
    if (newR > RAINBOW_LEN) return null;
    if (newR === RAINBOW_LEN) {
      events.push('finish');
      return { pos, rainbow:RAINBOW_LEN, events };
    }
    return { pos, rainbow:newR, events };
  }

  for (let s = 0; s < steps; s++) {
    if (pos === entryAt) {
      rainbow = 1;
      const remaining = steps - s - 1;
      const newR = rainbow + remaining;
      if (newR > RAINBOW_LEN) return null;
      if (newR === RAINBOW_LEN) events.push('finish');
      return { pos, rainbow:newR, events };
    }
    pos = (pos + 1) % N;
  }

  events.push('moved');
  return { pos, rainbow:0, events };
}

function pieceCanvasPos(color, piece) {
  const { pos, rainbow, id } = piece;
  if (pos === -1) {
    const spots = HOME_SPOTS[color];
    const [col, row] = spots[id];
    return { x:OFFSET_X + col * CS + CS/2, y:OFFSET_Y + row * CS + CS/2 };
  }
  if (rainbow > 0) {
    const ri = Math.min(rainbow - 1, RAINBOW_LEN - 1);
    const [col, row] = RAINBOW_PATH[color][ri];
    return { x:OFFSET_X + col * CS + CS/2, y:OFFSET_Y + row * CS + CS/2 };
  }
  const [col, row] = MAIN_PATH[pos];
  return { x:OFFSET_X + col * CS + CS/2, y:OFFSET_Y + row * CS + CS/2 };
}

function isSafe(pos) { return SAFE_SET.has(pos); }

// ─── 规则引擎（本地模式）─────────────────────────────────────

function getMovablePieces(color, dice) {
  return G.pieces[color].map((p, i) => ({ piece:p, idx:i })).filter(({ piece }) => {
    if (piece.rainbow >= RAINBOW_LEN) return false;
    if (piece.pos === -1) return dice === 6;
    return movePiece(color, piece, dice) !== null;
  }).map(x => x.idx);
}

function doLocalMove(color, pieceIdx, callback) {
  const piece = G.pieces[color][pieceIdx];
  const dice = G.dice;
  const result = movePiece(color, piece, dice);
  if (!result) { callback && callback(); return; }

  piece.pos = result.pos;
  piece.rainbow = result.rainbow;
  const events = result.events;
  let extraTurn = false;

  // 击退检查
  if (piece.rainbow === 0 && piece.pos !== -1 && !isSafe(piece.pos)) {
    G.players.forEach(c => {
      if (c === color) return;
      G.pieces[c].forEach(p => {
        if (p.pos === piece.pos && p.rainbow === 0) {
          p.pos = -1; p.rainbow = 0;
          events.push('kick:' + c);
          showToast(`${COLOR_NAME[color]} 击退了 ${COLOR_NAME[c]}！`);
        }
      });
    });
  }

  if (dice === 6) extraTurn = true;
  if (events.includes('finish')) {
    const done = G.pieces[color].filter(p => p.rainbow >= RAINBOW_LEN).length;
    showToast(`${COLOR_NAME[color]} 第 ${done} 颗棋子到达终点！`);
  }

  renderAll();
  checkWin(color);

  if (G.winner) { callback && callback(); return; }

  if (extraTurn) {
    showToast(`${COLOR_NAME[color]} 掷出6，再投一次！`);
    G.rolled = false;
    G.movable = [];
    updateUI();
    callback && callback();
  } else {
    nextLocalTurn();
    callback && callback();
  }
}

function checkWin(color) {
  if (G.pieces[color].every(p => p.rainbow >= RAINBOW_LEN) && !G.finished.includes(color)) {
    G.finished.push(color);
    if (G.finished.length === 1) {
      G.winner = color;
      showWin(color);
    }
  }
}

function nextLocalTurn() {
  G.turn = (G.turn + 1) % G.players.length;
  let safety = 0;
  while (G.finished.includes(currentColor()) && safety < G.players.length) {
    G.turn = (G.turn + 1) % G.players.length;
    safety++;
  }
  G.rolled = false;
  G.movable = [];
  G.dice = 0;
  updateUI();
  renderAll();
}

// ─── 骰子 ────────────────────────────────────────────────────

function setDiceFace(value) {
  const dots = document.querySelectorAll('#diceFace .dice-dot');
  const positions = DICE_DOTS[value] || [];
  dots.forEach((dot, i) => {
    dot.classList.toggle('show', positions.includes(i));
  });
}

function rollLocalDice(cb) {
  if (G.rolled || animating) return;
  G.rolled = true;

  const diceEl = document.getElementById('dice');
  const rollBtn = document.getElementById('rollBtn');
  rollBtn.disabled = true;
  diceEl.classList.add('rolling');

  let ticks = 0;
  const interval = setInterval(() => {
    const fake = Math.floor(Math.random() * 6) + 1;
    setDiceFace(fake);
    ticks++;
    if (ticks >= 8) {
      clearInterval(interval);
      diceEl.classList.remove('rolling');
      G.dice = Math.floor(Math.random() * 6) + 1;
      setDiceFace(G.dice);
      G.movable = getMovablePieces(currentColor(), G.dice);
      updateUI();
      renderAll();

      if (G.movable.length === 0) {
        if (G.dice === 6) {
          showToast('掷出6但无棋子可动，再投一次！');
          setTimeout(() => {
            G.rolled = false;
            updateUI();
          }, 800);
        } else {
          showToast('无棋子可移动，换人！');
          setTimeout(nextLocalTurn, 800);
        }
      } else {
        cb && cb();
      }
    }
  }, 60);
}

// ─── 联机骰子（发送给服务器）─────────────────────────────────

function rollOnlineDice(cb) {
  if (G.rolled || animating) return;
  const color = currentColor();
  if (config[color] !== 'human' || color !== myColor) return;

  G.rolled = true;
  document.getElementById('rollBtn').disabled = true;
  document.getElementById('dice').classList.add('rolling');

  // 让服务端摇骰子
  wsSend({ type:'roll_dice' });
}

// ─── 事件处理（统一入口）─────────────────────────────────────

document.getElementById('rollBtn').addEventListener('click', () => {
  if (!G || G.winner || G.rolled) return;
  if (onlineMode) {
    rollOnlineDice();
  } else {
    if (config[currentColor()] === 'ai') return;
    rollLocalDice();
  }
});

canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  handleCanvasClickAt(
    (t.clientX - rect.left) * scaleX,
    (t.clientY - rect.top) * scaleY
  );
}, { passive: false });

function handleCanvasClick(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  handleCanvasClickAt(
    (e.clientX - rect.left) * scaleX,
    (e.clientY - rect.top) * scaleY
  );
}

function handleCanvasClickAt(cx, cy) {
  if (!G || !G.rolled || G.winner || animating) return;
  const color = currentColor();

  if (onlineMode) {
    // 联机模式：只有轮到自己才能操作
    if (color !== myColor) return;
  } else {
    // 本地模式：当前玩家是人才可操作
    if (config[color] !== 'human') return;
  }

  if (G.movable.length === 0) return;

  const pr = CS * 0.28;
  for (const idx of G.movable) {
    const piece = G.pieces[color][idx];
    const { x, y } = pieceCanvasPos(color, piece);
    const dx = cx - x, dy = cy - y;
    if (dx * dx + dy * dy <= (pr + 6) * (pr + 6)) {
      if (onlineMode) {
        // 发送移动给服务端
        wsSend({ type:'move_piece', piece_idx:idx });
        G.movable = []; // 防止重复点击
      } else {
        doLocalMove(color, idx);
      }
      return;
    }
  }
}

// ─── 渲染 ────────────────────────────────────────────────────

function resizeCanvas() {
  const wrap = document.querySelector('.board-wrap');
  if (!wrap) return;
  const maxW = Math.min(wrap.clientWidth || 500, window.innerHeight * 0.85, 600);
  const size = Math.floor(maxW / 15) * 15;
  canvas.width = size;
  canvas.height = size;
  CS = size / 15;
  OFFSET_X = 0;
  OFFSET_Y = 0;
}

function renderAll() {
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBoard();
  if (G) drawPieces();
}

function drawBoard() {
  const W = canvas.width;

  // ── 棋盘外框与阴影 ──
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;

  // 木质纹理背景
  const bgGrad = ctx.createLinearGradient(0, 0, W, W);
  bgGrad.addColorStop(0, '#faf3e6');
  bgGrad.addColorStop(0.3, '#f5ecda');
  bgGrad.addColorStop(0.7, '#f0e7d0');
  bgGrad.addColorStop(1, '#ebe0c8');
  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, W, W, 12);
  ctx.fill();
  ctx.restore();

  // 细微纹理叠加
  ctx.save();
  ctx.globalAlpha = 0.03;
  for (let i = 0; i < W; i += 4) {
    ctx.strokeStyle = i % 8 === 0 ? '#8b7355' : '#a0926b';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, i + Math.sin(i * 0.1) * 1.5);
    ctx.lineTo(W, i + Math.cos(i * 0.1) * 1.5);
    ctx.stroke();
  }
  ctx.restore();

  // 外边框
  ctx.save();
  ctx.strokeStyle = '#c4a56e';
  ctx.lineWidth = 3;
  roundRect(ctx, 1.5, 1.5, W - 3, W - 3, 12);
  ctx.stroke();
  // 内边框装饰线
  ctx.strokeStyle = '#d4b87a';
  ctx.lineWidth = 1;
  roundRect(ctx, 5, 5, W - 10, W - 10, 10);
  ctx.stroke();
  ctx.restore();

  // ── 四个家区底色 ──
  const zones = [
    { color:'red',    cx:3,   cy:3,   cells:homeZone(0,0,6,6) },
    { color:'blue',   cx:12,  cy:3,   cells:homeZone(9,0,15,6) },
    { color:'green',  cx:12,  cy:12,  cells:homeZone(9,9,15,15) },
    { color:'yellow', cx:3,   cy:12,  cells:homeZone(0,9,6,15) },
  ];

  zones.forEach(({ color, cx, cy, cells }) => {
    if (G && config[color] === 'off') {
      // 灰掉未参与的家区
      ctx.fillStyle = '#888';
      ctx.globalAlpha = 0.15;
      cells.forEach(([c, r]) => {
        ctx.fillRect(OFFSET_X + c * CS, OFFSET_Y + r * CS, CS, CS);
      });
      ctx.globalAlpha = 1;
      return;
    }

    // 渐变底色
    const gx = OFFSET_X + cx * CS, gy = OFFSET_Y + cy * CS;
    const zGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 5 * CS);
    zGrad.addColorStop(0, COLOR_LIGHT[color]);
    zGrad.addColorStop(0.4, COLOR_HEX[color]);
    zGrad.addColorStop(1, COLOR_DARK[color]);
    ctx.fillStyle = zGrad;
    ctx.globalAlpha = 0.15;
    cells.forEach(([c, r]) => {
      ctx.fillRect(OFFSET_X + c * CS, OFFSET_Y + r * CS, CS, CS);
    });
    ctx.globalAlpha = 1;

    // 家区圆角矩形边框
    const bx = zones.find(z => z.color === color).cells[0];
    const bxx = OFFSET_X + bx[0] * CS;
    const byy = OFFSET_Y + bx[1] * CS;
    ctx.save();
    ctx.strokeStyle = COLOR_HEX[color];
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 3]);
    roundRect(ctx, bxx + 4, byy + 4, 6 * CS - 8, 6 * CS - 8, 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  });

  // ── 大圈路径格 ──
  const drawnPathCells = new Set(); // 跳过重复坐标（起飞格坐标优先，排在前面先画）
  MAIN_PATH.forEach(([c, r], i) => {
    const key = c + ',' + r;
    if (drawnPathCells.has(key)) return; // 跳过重复坐标
    drawnPathCells.add(key);

    const x = OFFSET_X + c * CS, y = OFFSET_Y + r * CS;
    const cx = x + CS / 2, cy = y + CS / 2;
    const startEntries = { 0:'red', 13:'blue', 26:'green', 39:'yellow' };

    if (startEntries[i] && (!G || config[startEntries[i]] !== 'off')) {
      // 起飞格 — 颜色渐变填充 + 箭头指示
      const sGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, CS * 0.55);
      sGrad.addColorStop(0, COLOR_LIGHT[startEntries[i]]);
      sGrad.addColorStop(1, COLOR_HEX[startEntries[i]]);
      ctx.fillStyle = sGrad;
      ctx.globalAlpha = 0.7;
      roundRect(ctx, x + 1.5, y + 1.5, CS - 3, CS - 3, CS * 0.15);
      ctx.fill();
      ctx.globalAlpha = 1;

      // 起飞格白色边框
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      roundRect(ctx, x + 2.5, y + 2.5, CS - 5, CS - 5, CS * 0.12);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (SAFE_SET.has(i)) {
      // 安全格 — 金色星形
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.8;
      roundRect(ctx, x + 1.5, y + 1.5, CS - 3, CS - 3, CS * 0.15);
      ctx.fill();
      ctx.globalAlpha = 1;

      // 金色星
      drawStar(cx, cy, CS * 0.18, CS * 0.35, 5, '#f0c040', '#e8a820');
    } else {
      // 普通格子 — 浅色圆角
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.65;
      roundRect(ctx, x + 1.5, y + 1.5, CS - 3, CS - 3, CS * 0.12);
      ctx.fill();
      ctx.globalAlpha = 1;

      // 格子内阴影效果
      const cellGrad = ctx.createLinearGradient(x, y, x, y + CS);
      cellGrad.addColorStop(0, 'rgba(255,255,255,0.3)');
      cellGrad.addColorStop(1, 'rgba(0,0,0,0.04)');
      ctx.fillStyle = cellGrad;
      roundRect(ctx, x + 1.5, y + 1.5, CS - 3, CS - 3, CS * 0.12);
      ctx.fill();
    }
  });

  // ── 彩虹道 ──
  const rainbowColors = {
    red: ['#ff8a80','#ff5252','#e74c3c','#d32f2f','#c62828','#b71c1c'],
    blue: ['#82b1ff','#448aff','#2980b9','#1565c0','#0d47a1','#0a3a8f'],
    green: ['#69f0ae','#00e676','#27ae60','#1b8a4f','#1b5e20','#134a1a'],
    yellow: ['#ffd740','#ffca28','#f39c12','#e88c00','#e65100','#c43e00'],
  };

  Object.entries(RAINBOW_PATH).forEach(([color, cells]) => {
    if (G && config[color] === 'off') return;
    const cols = rainbowColors[color];
    cells.forEach(([c, r], i) => {
      const x = OFFSET_X + c * CS, y = OFFSET_Y + r * CS;
      const cx = x + CS / 2, cy = y + CS / 2;

      // 渐变色格子（越靠近终点颜色越深）
      const rGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, CS * 0.6);
      rGrad.addColorStop(0, cols[i]);
      rGrad.addColorStop(1, cols[Math.min(i + 1, cols.length - 1)]);
      ctx.fillStyle = rGrad;
      ctx.globalAlpha = 0.65;
      roundRect(ctx, x + 1, y + 1, CS - 2, CS - 2, CS * 0.12);
      ctx.fill();
      ctx.globalAlpha = 1;

      // 白色内框
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      roundRect(ctx, x + 3, y + 3, CS - 6, CS - 6, CS * 0.08);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  });

  // ── 终点中心 ──
  const cx7 = OFFSET_X + 7 * CS, cy7 = OFFSET_Y + 7 * CS;
  const centerGrad = ctx.createRadialGradient(
    cx7 + CS / 2, cy7 + CS / 2, 0,
    cx7 + CS / 2, cy7 + CS / 2, CS * 0.7
  );
  centerGrad.addColorStop(0, '#fff8e1');
  centerGrad.addColorStop(0.5, '#ffecb3');
  centerGrad.addColorStop(1, '#f0c040');
  ctx.fillStyle = centerGrad;
  roundRect(ctx, cx7, cy7, CS, CS, CS * 0.15);
  ctx.fill();

  // 中心四色三角装饰
  const ccx = cx7 + CS / 2, ccy = cy7 + CS / 2;
  const cs = CS * 0.32;
  [[0, '#e74c3c'], [Math.PI / 2, '#f39c12'], [Math.PI, '#27ae60'], [Math.PI * 1.5, '#2980b9']].forEach(([angle, clr]) => {
    ctx.beginPath();
    ctx.moveTo(ccx, ccy);
    ctx.lineTo(ccx + Math.cos(angle - 0.8) * cs, ccy + Math.sin(angle - 0.8) * cs);
    ctx.lineTo(ccx + Math.cos(angle + 0.8) * cs, ccy + Math.sin(angle + 0.8) * cs);
    ctx.closePath();
    ctx.fillStyle = clr;
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // ── 家区圆圈（停机坪） ──
  Object.entries(HOME_SPOTS).forEach(([color, spots]) => {
    if (G && config[color] === 'off') return;
    spots.forEach(([c, r]) => {
      const cx = OFFSET_X + c * CS + CS / 2;
      const cy = OFFSET_Y + r * CS + CS / 2;
      const rad = CS * 0.36;

      // 外圈阴影
      ctx.save();
      ctx.shadowColor = COLOR_DARK[color];
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;

      // 渐变填充
      const hGrad = ctx.createRadialGradient(cx - rad * 0.2, cy - rad * 0.2, 0, cx, cy, rad);
      hGrad.addColorStop(0, COLOR_LIGHT[color]);
      hGrad.addColorStop(0.6, COLOR_HEX[color]);
      hGrad.addColorStop(1, COLOR_DARK[color]);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = hGrad;
      ctx.globalAlpha = 0.4;
      ctx.fill();
      ctx.globalAlpha = 1;

      // 描边
      ctx.strokeStyle = COLOR_HEX[color];
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // 内圈
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.65, 0, Math.PI * 2);
      ctx.strokeStyle = COLOR_HEX[color];
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  });

  // ── 家区颜色名 ──
  const homeBoxes = [
    { color:'red', x:0, y:0 },
    { color:'blue', x:9, y:0 },
    { color:'green', x:9, y:9 },
    { color:'yellow', x:0, y:9 },
  ];
  homeBoxes.forEach(({ color, x, y }) => {
    if (G && config[color] === 'off') return;

    let label = COLOR_NAME[color];
    if (G && config[color] === 'ai') label += ' (AI)';

    // 文字阴影底色
    const tx = OFFSET_X + (x + 3) * CS;
    const ty = OFFSET_Y + (y + 0.6) * CS;
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.5;
    ctx.font = `bold ${Math.floor(CS * 0.48)}px 'PingFang SC','Microsoft YaHei',sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tx, ty);
    ctx.globalAlpha = 1;

    // 文字主体
    ctx.fillStyle = COLOR_DARK[color];
    ctx.fillText(label, tx, ty);
  });

  // ── 中间走道网格线 ──
  ctx.strokeStyle = 'rgba(180,160,130,0.25)';
  ctx.lineWidth = 0.5;
  for (let i = 6; i <= 9; i++) {
    ctx.beginPath();
    ctx.moveTo(OFFSET_X + i * CS, OFFSET_Y + 6 * CS);
    ctx.lineTo(OFFSET_X + i * CS, OFFSET_Y + 9 * CS);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(OFFSET_X + 6 * CS, OFFSET_Y + i * CS);
    ctx.lineTo(OFFSET_X + 9 * CS, OFFSET_Y + i * CS);
    ctx.stroke();
  }
}

// 绘制五角星
function drawStar(cx, cy, innerR, outerR, points, fill, stroke) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI / points) - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function homeZone(c0, r0, c1, r1) {
  const cells = [];
  for (let c = c0; c < c1; c++) for (let r = r0; r < r1; r++) cells.push([c, r]);
  return cells;
}

function drawPieces() {
  if (!G) return;
  const pr = CS * 0.3;
  const movableSet = new Set(G.movable);
  const color = currentColor();

  G.players.forEach(c => {
    G.pieces[c].forEach((piece, idx) => {
      if (piece.rainbow >= RAINBOW_LEN) return;
      let { x, y } = pieceCanvasPos(c, piece);

      // 同一格多棋子偏移
      const overlap = findOverlaps(c, idx);
      if (overlap.length > 1) {
        const myIdx = overlap.indexOf(idx);
        const offsets = [[-3,-3],[3,-3],[-3,3],[3,3]];
        const off = offsets[myIdx] || [0,0];
        x += off[0]; y += off[1];
      }

      const isMovable = (c === color && movableSet.has(idx) && G.rolled);
      const isMyPiece = onlineMode ? c === myColor : true;

      draw3DPiece(x, y, pr, c, isMovable, idx);
    });
  });

  // 终点棋子
  G.players.forEach((c, ci) => {
    const done = G.pieces[c].filter(p => p.rainbow >= RAINBOW_LEN);
    done.forEach((piece, di) => {
      const angle = ((ci * 4 + di) / 16) * Math.PI * 2;
      const r = CS * 0.28;
      const cx = OFFSET_X + 7.5 * CS + Math.cos(angle) * r;
      const cy = OFFSET_Y + 7.5 * CS + Math.sin(angle) * r;
      draw3DPiece(cx, cy, CS * 0.18, c, false, -1, true);
    });
  });

  // 脉冲动画
  if (G && G.rolled && G.movable.length > 0 && isMyTurnHuman()) {
    requestAnimationFrame(() => { if (G && G.rolled) drawPieces(); });
  }
}

function draw3DPiece(x, y, radius, color, isMovable, idx, isDone) {
  ctx.save();

  // 阴影
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 3;

  // 底层深色圆（模拟厚度）
  ctx.beginPath();
  ctx.arc(x, y + 2, radius, 0, Math.PI * 2);
  ctx.fillStyle = COLOR_DARK[color];
  ctx.fill();

  // 主体渐变
  const grad = ctx.createRadialGradient(
    x - radius * 0.3, y - radius * 0.3, radius * 0.1,
    x, y, radius
  );
  grad.addColorStop(0, COLOR_LIGHT[color]);
  grad.addColorStop(0.5, COLOR_HEX[color]);
  grad.addColorStop(1, COLOR_DARK[color]);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // 去掉阴影画上层细节
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // 高光
  ctx.beginPath();
  ctx.arc(x - radius * 0.2, y - radius * 0.2, radius * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();

  // 小高光点
  ctx.beginPath();
  ctx.arc(x - radius * 0.25, y - radius * 0.3, radius * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();

  // 描边
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = isDone ? '#f0c040' : (isMovable ? '#fff' : 'rgba(255,255,255,0.5)');
  ctx.lineWidth = isDone ? 2 : (isMovable ? 2.5 : 1.2);
  ctx.stroke();

  // 棋子编号（未完成状态）
  if (idx >= 0) {
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(radius * 0.95)}px 'Segoe UI','PingFang SC',sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 文字阴影
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 2;
    ctx.fillText(idx + 1, x, y + 1);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  // 完成状态画对勾
  if (isDone) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.35, y);
    ctx.lineTo(x - radius * 0.05, y + radius * 0.3);
    ctx.lineTo(x + radius * 0.4, y - radius * 0.3);
    ctx.stroke();
  }

  // 可移动脉冲光环
  if (isMovable) {
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
    ctx.beginPath();
    ctx.arc(x, y, radius + 4 + pulse * 3, 0, Math.PI * 2);
    ctx.strokeStyle = COLOR_LIGHT[color];
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.4 + pulse * 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function findOverlaps(color, myIdx) {
  const myPiece = G.pieces[color][myIdx];
  const indices = [];
  G.pieces[color].forEach((p, i) => {
    if (p.rainbow >= RAINBOW_LEN) return;
    if (p.pos === myPiece.pos && p.rainbow === myPiece.rainbow) {
      indices.push(i);
    }
  });
  return indices;
}

function isMyTurnHuman() {
  if (onlineMode) {
    return currentColor() === myColor;
  }
  return config[currentColor()] === 'human';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─── UI更新 ──────────────────────────────────────────────────

function updateUI() {
  if (!G) return;
  const color = currentColor();
  const isAI = config[color] === 'ai';
  const isMyTurn = onlineMode ? (color === myColor) : true;

  const tp = document.getElementById('turnPlayer');
  let label = COLOR_NAME[color] + ' 的回合';
  if (onlineMode && color === myColor) label += '（你）';
  tp.textContent = label;
  tp.style.color = COLOR_HEX[color];

  const hint = document.getElementById('turnHint');
  if (!G.rolled) {
    hint.textContent = isAI ? '电脑思考中...' :
      (onlineMode && color !== myColor ? '等待对方操作...' : '点击骰子摇骰');
  } else if (G.movable.length > 0) {
    hint.textContent = isAI ? '电脑移动中...' :
      (isMyTurn ? `点击棋子移动（${G.movable.length}个可选）` : '等待对方移动...');
  } else {
    hint.textContent = '等待换人...';
  }

  const canRoll = !G.rolled && !isAI && !G.winner &&
    (onlineMode ? color === myColor : true);
  document.getElementById('rollBtn').disabled = !canRoll;

  const movableHint = document.getElementById('movableHint');
  movableHint.style.display = (isMyTurn && G.rolled && G.movable.length > 0) ? 'block' : 'none';

  updatePiecesStatus();
}

function updatePiecesStatus() {
  const el = document.getElementById('piecesStatus');
  let html = '<div class="status-title">棋子状态</div>';
  G.players.forEach(color => {
    const pieces = G.pieces[color];
    const name = onlineMode ? (color === myColor ? '你' : COLOR_NAME[color]) : COLOR_NAME[color];
    const type = config[color] === 'ai' ? ' (AI)' : '';
    html += `<div class="status-row">
      <div class="status-dot" style="background:${COLOR_HEX[color]}"></div>
      <div class="status-text">${name}${type}</div>
      <div class="status-pieces">
        ${pieces.map(p => `<div class="status-piece-icon ${p.pos===-1?'home':p.rainbow>=RAINBOW_LEN?'done':''}" style="background:${p.pos===-1?'#333':COLOR_HEX[color]}"></div>`).join('')}
      </div>
    </div>`;
  });
  el.innerHTML = html;
}

// ─── Toast & 胜利 ────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, duration = 1800) {
  const el = document.getElementById('toastEl');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, duration);
}

function showWin(color) {
  let label = COLOR_NAME[color] + ' 获胜！';
  if (onlineMode && color === myColor) label = '恭喜你获胜！';
  document.getElementById('winTitle').textContent = label;
  document.getElementById('winTitle').style.color = COLOR_HEX[color];
  document.getElementById('winOverlay').style.display = 'flex';
  document.getElementById('rollBtn').disabled = true;
}

// ─── 返回/重开 ──────────────────────────────────────────────

function returnToMenu() {
  G = null;
  if (ws) { ws.close(); ws = null; }
  onlineMode = false;
  myColor = null;
  roomId = null;
  document.getElementById('winOverlay').style.display = 'none';
  setDiceFace(0);
  document.getElementById('joinDialog').style.display = 'none';
  showScreen('menuScreen');
}

function restartGame() {
  document.getElementById('winOverlay').style.display = 'none';
  if (onlineMode) {
    wsSend({ type:'restart' });
    return;
  }
  startLocalGame();
}

document.getElementById('menuBtn').addEventListener('click', returnToMenu);
document.getElementById('restartBtn').addEventListener('click', restartGame);
document.getElementById('winRestart').addEventListener('click', restartGame);
document.getElementById('winMenu').addEventListener('click', returnToMenu);

// 窗口缩放
window.addEventListener('resize', () => {
  if (document.getElementById('gameScreen').classList.contains('active')) {
    renderAll();
  }
});

// pageshow 处理 bfcache
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    document.querySelectorAll('.overlay').forEach(o => o.style.display = 'none');
  }
});

// 初始化
showScreen('menuScreen');
