/**
 * 五子棋 — 本地对战 + 联机对战
 * =====================================================
 * 模块：
 *   1. CONFIG        — 常量
 *   2. BoardRenderer — Canvas 渲染
 *   3. TimerUI       — 倒计时圆环（联机用）
 *   4. LocalGame     — 本地对战逻辑（纯状态 + UI）
 *   5. OnlineGame    — 联机对战逻辑（WebSocket）
 *   6. App           — 入口 + 大厅流程 + Canvas 事件分发
 * =====================================================
 */
'use strict';

/* ====================================================
   1. CONFIG
   ==================================================== */
const CONFIG = {
  BOARD_SIZE : 15, CANVAS_SIZE: 600, PADDING: 32,
  WIN_COUNT  : 5,  TURN_SECS: 30, SWAP_ROUNDS: 2,
  WS_URL     : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws',
  STONE: { BLACK: 1, WHITE: 2, EMPTY: 0 },
  DIRS: [[1,0],[0,1],[1,1],[1,-1]],
};
CONFIG.CELL = (CONFIG.CANVAS_SIZE - CONFIG.PADDING*2) / (CONFIG.BOARD_SIZE - 1);

/* ====================================================
   2. BoardRenderer — Canvas
   ==================================================== */
const Renderer = (() => {
  let canvas, ctx;
  function init(el) { canvas = el; ctx = el.getContext('2d'); }
  function px(col, row) {
    return { x: CONFIG.PADDING + col*CONFIG.CELL, y: CONFIG.PADDING + row*CONFIG.CELL };
  }
  function toGrid(mouseX, mouseY) {
    const c = Math.round((mouseX - CONFIG.PADDING)/CONFIG.CELL);
    const r = Math.round((mouseY - CONFIG.PADDING)/CONFIG.CELL);
    if (c<0||c>=CONFIG.BOARD_SIZE||r<0||r>=CONFIG.BOARD_SIZE) return null;
    const p = px(c,r);
    return Math.hypot(mouseX-p.x, mouseY-p.y) <= CONFIG.CELL*.5 ? {col:c,row:r} : null;
  }
  function eventToGrid(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width/rect.width, sy = canvas.height/rect.height;
    return toGrid((e.clientX-rect.left)*sx, (e.clientY-rect.top)*sy);
  }
  function drawBoard() {
    ctx.fillStyle='#dcb96a'; ctx.fillRect(0,0,CONFIG.CANVAS_SIZE,CONFIG.CANVAS_SIZE);
    const g=ctx.createLinearGradient(0,0,CONFIG.CANVAS_SIZE,CONFIG.CANVAS_SIZE);
    g.addColorStop(0,'rgba(180,110,30,.08)'); g.addColorStop(.5,'rgba(220,175,90,.04)'); g.addColorStop(1,'rgba(160,100,20,.1)');
    ctx.fillStyle=g; ctx.fillRect(0,0,CONFIG.CANVAS_SIZE,CONFIG.CANVAS_SIZE);
    ctx.strokeStyle='#8b6914'; ctx.lineWidth=1;
    for(let i=0;i<CONFIG.BOARD_SIZE;i++){
      ctx.beginPath(); ctx.moveTo(px(0,i).x,px(0,i).y); ctx.lineTo(px(CONFIG.BOARD_SIZE-1,i).x,px(CONFIG.BOARD_SIZE-1,i).y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px(i,0).x,px(i,0).y); ctx.lineTo(px(i,CONFIG.BOARD_SIZE-1).x,px(i,CONFIG.BOARD_SIZE-1).y); ctx.stroke();
    }
    const stars=[[3,3],[3,11],[11,3],[11,11],[3,7],[7,3],[7,11],[11,7],[7,7]];
    ctx.fillStyle='#8b6914';
    stars.forEach(([c,r])=>{const p=px(c,r);ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();});
    ctx.fillStyle='#7a5a10'; ctx.font='11px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    for(let i=0;i<CONFIG.BOARD_SIZE;i++){
      ctx.fillText(String.fromCharCode(65+i),px(i,0).x,CONFIG.PADDING-14);
      ctx.fillText(i+1,CONFIG.PADDING-16,px(0,i).y);
    }
  }
  function drawStone(col,row,color,isLast=false){
    const p=px(col,row), r=CONFIG.CELL*.44, bk=color===CONFIG.STONE.BLACK;
    ctx.shadowColor='rgba(0,0,0,.45)'; ctx.shadowBlur=6; ctx.shadowOffsetX=2; ctx.shadowOffsetY=2;
    const gd=ctx.createRadialGradient(p.x-r*.3,p.y-r*.3,r*.05,p.x,p.y,r);
    if(bk){gd.addColorStop(0,'#666');gd.addColorStop(.6,'#222');gd.addColorStop(1,'#111');}
    else{gd.addColorStop(0,'#fff');gd.addColorStop(.6,'#e0e0e0');gd.addColorStop(1,'#c0c0c0');}
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=gd;ctx.fill();
    if(!bk){ctx.shadowColor='transparent';ctx.strokeStyle='#aaa';ctx.lineWidth=.5;ctx.stroke();}
    ctx.shadowColor='transparent';ctx.shadowBlur=ctx.shadowOffsetX=ctx.shadowOffsetY=0;
    if(isLast){ctx.beginPath();ctx.arc(p.x,p.y,r*.22,0,Math.PI*2);ctx.fillStyle=bk?'#ff4455':'#cc2233';ctx.fill();}
  }
  function drawHover(col,row,color){
    const p=px(col,row),r=CONFIG.CELL*.44;
    ctx.globalAlpha=.35;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);
    ctx.fillStyle=color===CONFIG.STONE.BLACK?'#222':'#f0f0f0';ctx.fill();ctx.globalAlpha=1;
  }
  function drawWinLine(stones){
    stones.forEach(({col,row})=>{
      const p=px(col,row),r=CONFIG.CELL*.44;
      ctx.beginPath();ctx.arc(p.x,p.y,r+3,0,Math.PI*2);ctx.strokeStyle='#f0c040';ctx.lineWidth=3;ctx.stroke();
    });
  }
  function renderAll(history){
    drawBoard();
    history.forEach((m,i)=>drawStone(m.col,m.row,m.color,i===history.length-1));
  }
  return { init, toGrid, eventToGrid, drawBoard, drawStone, drawHover, drawWinLine, renderAll };
})();


/* ====================================================
   3. TimerUI — 倒计时圆环（联机用）
   ==================================================== */
const TimerUI = (() => {
  const C = 2*Math.PI*34;
  let elNum, elArc, raf=null, deadline=0;
  function init(){ elNum=document.getElementById('timerNum'); elArc=document.getElementById('timerArc'); }
  function start(ms){ deadline=ms; stop(); tick(); }
  function stop(){ if(raf!==null){cancelAnimationFrame(raf);raf=null;} _set(CONFIG.TURN_SECS,false); }
  function tick(){
    const rem=Math.max(0,(deadline-Date.now())/1000);
    _set(rem,rem<=10);
    if(rem>0) raf=requestAnimationFrame(tick);
  }
  function _set(rem,urg){
    elNum.textContent=Math.ceil(rem);
    elArc.style.strokeDashoffset = C*(1-rem/CONFIG.TURN_SECS);
    elArc.classList.toggle('urgent',urg);
  }
  return { init, start, stop };
})();


/* ====================================================
   4. LocalGame — 本地对战（纯逻辑，不含 canvas 事件）
   ==================================================== */
const LocalGame = (() => {
  let board=[], history=[], current=CONFIG.STONE.BLACK, over=false;

  function reset(){
    board=Array.from({length:CONFIG.BOARD_SIZE},()=>Array(CONFIG.BOARD_SIZE).fill(CONFIG.STONE.EMPTY));
    history=[]; current=CONFIG.STONE.BLACK; over=false;
  }

  function place(col,row){
    if(over) return {ok:false};
    if(board[row][col]!==CONFIG.STONE.EMPTY) return {ok:false};
    board[row][col]=current;
    history.push({col,row,color:current});

    const winStones=_checkWin(col,row,current);
    if(winStones){ over=true; return {ok:true,win:true,draw:false,stones:winStones}; }
    if(history.length>=CONFIG.BOARD_SIZE*CONFIG.BOARD_SIZE){ over=true; return {ok:true,win:false,draw:true,stones:[]}; }

    current=current===CONFIG.STONE.BLACK?CONFIG.STONE.WHITE:CONFIG.STONE.BLACK;
    return {ok:true,win:false,draw:false,stones:[]};
  }

  function undo(){
    if(!history.length) return null;
    const m=history.pop();
    board[m.row][m.col]=CONFIG.STONE.EMPTY;
    current=m.color; over=false;
    return m;
  }

  function isEmpty(col,row){ return board[row][col]===CONFIG.STONE.EMPTY; }
  function isOver(){ return over; }
  function getCurrent(){ return current; }
  function getHistory(){ return history; }

  function _checkWin(col,row,color){
    for(const[dc,dr]of CONFIG.DIRS){
      const line=_scan(col,row,dc,dr,color);
      if(line.length>=CONFIG.WIN_COUNT) return line;
    }
    return null;
  }
  function _scan(col,row,dc,dr,color){
    const stones=[{col,row}];
    let c=col+dc,r=row+dr;
    while(c>=0&&c<CONFIG.BOARD_SIZE&&r>=0&&r<CONFIG.BOARD_SIZE&&board[r][c]===color){stones.push({col:c,row:r});c+=dc;r+=dr;}
    c=col-dc;r=row-dr;
    while(c>=0&&c<CONFIG.BOARD_SIZE&&r>=0&&r<CONFIG.BOARD_SIZE&&board[r][c]===color){stones.unshift({col:c,row:r});c-=dc;r-=dr;}
    return stones;
  }

  return { reset, place, undo, isEmpty, isOver, getCurrent, getHistory };
})();


/* ====================================================
   5. OnlineGame — 联机对战（WebSocket + 状态镜像）
   ==================================================== */
const OnlineGame = (() => {
  let ws=null, handlers={};
  let board=[], history=[], myColor=0, current=CONFIG.STONE.BLACK, over=false;
  let roomName='', myName='', opponentName='';
  let names={black:'',white:''};   // 当前局黑白方昵称
  let scores={black:0,white:0,draw:0};
  let roundNum=1;

  function on(t,fn){ handlers[t]=fn; }
  function send(type,data={}){
    if(ws&&ws.readyState===1) ws.send(JSON.stringify({type,...data}));
  }
  function close(){ if(ws){ws.onclose=null;ws.close();ws=null;} }
  function isConnected(){ return ws&&ws.readyState===1; }

  function connect(room, name){
    return new Promise((resolve,reject)=>{
      roomName=room;
      myName=name;
      ws=new WebSocket(CONFIG.WS_URL);
      const timer=setTimeout(()=>{ reject(new Error('连接超时，请检查网络')); ws.close(); }, 5000);
      ws.onopen=()=>{
        clearTimeout(timer);
        ws.send(JSON.stringify({type:'join',room,name}));
        resolve();
      };
      ws.onerror=()=>{ clearTimeout(timer); reject(new Error('无法连接服务器')); };
      ws.onmessage=(e)=>{
        let m; try{m=JSON.parse(e.data);}catch{return;}
        const fn=handlers[m.type]; if(fn)fn(m);
      };
      ws.onclose=()=>{ clearTimeout(timer); const fn=handlers['_close']; if(fn)fn(); };
    });
  }

  function requestRematch(){
    send('rematch');
  }

  function replyRematch(accept){
    send('rematch_reply',{accept});
  }

  function requestUndo(){
    send('undo');
  }

  function replyUndo(accept){
    send('undo_reply',{accept});
  }

  function setupHandlers(onStart, onTurn, onPlaced, onGameOver, onOpponentLeft, onWaiting, onRematchRequest, onRematchResult, onInfo, onUndoRequest, onUndoDone, onUndoRejected){
    on('waiting', ()=>{ if(onWaiting)onWaiting(); });
    on('info', (msg)=>{ if(onInfo)onInfo(msg); });

    on('start', (msg)=>{
      board=Array.from({length:CONFIG.BOARD_SIZE},()=>Array(CONFIG.BOARD_SIZE).fill(CONFIG.STONE.EMPTY));
      history=[]; over=false;
      myColor = msg.color==='black'?CONFIG.STONE.BLACK:CONFIG.STONE.WHITE;
      current = CONFIG.STONE.BLACK;
      names = msg.names || {black:'',white:''};
      scores = msg.scores || {black:0,white:0,draw:0};
      roundNum = msg.round || 1;
      opponentName = myColor===CONFIG.STONE.BLACK ? names.white : names.black;
      if(onStart) onStart(msg.color, msg);
    });

    on('turn', (msg)=>{
      current = msg.color==='black'?CONFIG.STONE.BLACK:CONFIG.STONE.WHITE;
      if(onTurn) onTurn(msg.color, msg.deadline);
    });

    on('placed', (msg)=>{
      const color = msg.color==='black'?CONFIG.STONE.BLACK:CONFIG.STONE.WHITE;
      board[msg.row][msg.col]=color;
      history.push({col:msg.col,row:msg.row,color});
      if(onPlaced) onPlaced(msg.col,msg.row,color);
    });

    on('over', (msg)=>{
      over=true;
      // 分数由服务端统一管理，客户端同步更新
      if(msg.winner!=='draw'){
        const key = msg.winner_name || msg.winner; // 优先用昵称
        scores[key] = (scores[key]||0)+1;
      }
      if(onGameOver) onGameOver(msg.winner, msg.stones||[]);
    });

    on('opponent_left', ()=>{ if(onOpponentLeft)onOpponentLeft(); });

    on('undo_request', (msg)=>{
      if(onUndoRequest) onUndoRequest(msg.from);
    });

    on('undo_done', (msg)=>{
      // 兼容新旧格式：新格式用 moves 数组，旧格式用 col/row/color 单步
      const moves = msg.moves || [];
      if(moves.length){
        // 新格式：撤回多步
        for(let i = 0; i < moves.length; i++){
          if(history.length) history.pop();
          const m = moves[i];
          board[m.row][m.col] = CONFIG.STONE.EMPTY;
        }
      } else if(msg.col != null && msg.row != null){
        // 旧格式兼容：撤回单步
        if(history.length) history.pop();
        const color = msg.color==='black'?CONFIG.STONE.BLACK:CONFIG.STONE.WHITE;
        board[msg.row][msg.col] = CONFIG.STONE.EMPTY;
      }
      if(onUndoDone) onUndoDone(moves.length ? moves : [{col:msg.col, row:msg.row, color:msg.color}]);
    });

    on('undo_rejected', ()=>{
      if(onUndoRejected) onUndoRejected();
    });

    on('rematch_request', (msg)=>{
      if(onRematchRequest) onRematchRequest(msg.from);
    });

    on('rematch_result', (msg)=>{
      if(onRematchResult) onRematchResult(msg.accepted);
    });

    on('error', (msg)=>{ console.warn('服务端:',msg.msg); });
  }

  function isMyTurn(){ return !over && current===myColor; }
  function isEmpty(col,row){ return board[row][col]===CONFIG.STONE.EMPTY; }
  function isOver(){ return over; }
  function getCurrent(){ return current; }
  function getMyColor(){ return myColor; }
  function getHistory(){ return history; }
  function getRoomName(){ return roomName; }
  function getMyName(){ return myName; }
  function getOpponentName(){ return opponentName; }
  function getNames(){ return names; }
  function getScores(){ return scores; }
  function getRoundNum(){ return roundNum; }

  return { on, connect, send, close, isConnected, setupHandlers,
           requestRematch, replyRematch, requestUndo, replyUndo,
           isMyTurn, isEmpty, isOver, getCurrent, getMyColor, getHistory, getRoomName,
           getMyName, getOpponentName, getNames, getScores, getRoundNum };
})();


/* ====================================================
   6. App — 入口 + 大厅 + Canvas 事件 + UI
   ==================================================== */
const App = (() => {
  let mode = null; // 'local' | 'online'
  let scores = { black:0, white:0 };
  let hoverCell = null;

  // DOM refs
  let elCanvas, elTurnText, elStonePreview, elTurnIndicator;
  let elHistoryList, elBlackScore, elWhiteScore, elRoomLabel;
  let elMyColorCard, elMyStonePreview, elMyColorName;
  let elTimerCard, elBtnRestart, elBtnUndo, elBtnLeave;
  let elModalOverlay, elModalIcon, elModalTitle, elModalDesc, elModalBtnGroup;
  let elBlackNameLabel, elWhiteNameLabel, elRoundInfo, elRoundText;

  function init(){
    elCanvas       = document.getElementById('board');
    elTurnText     = document.getElementById('turnText');
    elStonePreview = document.getElementById('stonePreview');
    elTurnIndicator= document.getElementById('turnIndicator');
    elHistoryList  = document.getElementById('historyList');
    elBlackScore   = document.getElementById('blackScore');
    elWhiteScore   = document.getElementById('whiteScore');
    elRoomLabel    = document.getElementById('roomLabel');
    elMyColorCard  = document.getElementById('myColorCard');
    elMyStonePreview=document.getElementById('myStonePreview');
    elMyColorName  = document.getElementById('myColorName');
    elTimerCard    = document.getElementById('timerCard');
    elBtnRestart   = document.getElementById('btnRestart');
    elBtnUndo      = document.getElementById('btnUndo');
    elBtnLeave     = document.getElementById('btnLeave');
    elModalOverlay = document.getElementById('modalOverlay');
    elModalIcon    = document.getElementById('modalIcon');
    elModalTitle   = document.getElementById('modalTitle');
    elModalDesc    = document.getElementById('modalDesc');
    elModalBtnGroup= document.getElementById('modalBtnGroup');
    elBlackNameLabel=document.getElementById('blackNameLabel');
    elWhiteNameLabel=document.getElementById('whiteNameLabel');
    elRoundInfo    = document.getElementById('roundInfo');
    elRoundText    = document.getElementById('roundText');

    Renderer.init(elCanvas);
    TimerUI.init();
    _bindLobby();
  }

  /* ── 大厅流程 ─────────────────────── */
  function _showStep(id){
    document.querySelectorAll('.lobby-step').forEach(el=>el.style.display='none');
    document.getElementById(id).style.display='';
  }

  function _bindLobby(){
    document.getElementById('btnLocal').onclick     = ()=>{ AudioFX.play('click'); _enterLocal(); };
    document.getElementById('btnOnline').onclick     = ()=>{ AudioFX.play('click'); _showStep('stepName'); };
    document.getElementById('btnBackFromName').onclick = ()=>{ AudioFX.play('click'); _showStep('stepMode'); };
    document.getElementById('btnNameConfirm').onclick = ()=>{ AudioFX.play('click'); _afterNameInput(); };
    document.getElementById('nameInput').addEventListener('keydown',(e)=>{if(e.key==='Enter')_afterNameInput();});
    document.getElementById('btnBackMode').onclick    = ()=>{ AudioFX.play('click'); _showStep('stepMode'); };
    document.getElementById('btnCreate').onclick      = ()=>{ AudioFX.play('click'); _createRoom(); };
    document.getElementById('btnJoin').onclick        = ()=>{ AudioFX.play('click'); _showStep('stepJoin'); };
    document.getElementById('btnBackOnline1').onclick = ()=>{ AudioFX.play('click'); _showStep('stepOnline'); };
    document.getElementById('btnBackOnline2').onclick = ()=>{ AudioFX.play('click'); _showStep('stepOnline'); };
    document.getElementById('btnJoinConfirm').onclick = ()=>{ AudioFX.play('click'); _joinRoom(); };
    document.getElementById('roomInput').addEventListener('keydown',(e)=>{if(e.key==='Enter')_joinRoom();});
    document.getElementById('btnCopy').onclick = ()=>{
      const code=document.getElementById('roomCode').textContent;
      const btn=document.getElementById('btnCopy');
      if(navigator.clipboard && window.isSecureContext){
        navigator.clipboard.writeText(code).then(()=>{
          btn.textContent='已复制'; setTimeout(()=>btn.textContent='复制',1500);
        });
      } else {
        const ta=document.createElement('textarea');
        ta.value=code; ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent='已复制'; setTimeout(()=>btn.textContent='复制',1500);
      }
    };
    document.getElementById('btnBackLobby').onclick = ()=> { AudioFX.play('click'); _exitToLobby(); };

  }

  function _afterNameInput(){
    const name=document.getElementById('nameInput').value.trim();
    if(!name){ document.getElementById('nameInput').style.borderColor='#ff4444'; return; }
    document.getElementById('nameInput').style.borderColor='';
    _showStep('stepOnline');
  }

  /* ── 进入本地对战 ─────────────────── */
  function _enterLocal(){
    mode='local';
    scores = {black:0, white:0};
    LocalGame.reset();
    _showGameUI(false);
    _updateScoreLabels();
    _renderLocal();
    _bindLocalCanvas();
    _updateLocalTurn();
  }

  /* ── 进入联机 - 创建房间 ─────────── */
  async function _createRoom(){
    const name = document.getElementById('nameInput').value.trim() || '玩家';
    const room = 'room_'+Math.random().toString(36).substring(2,8);
    document.getElementById('roomCode').textContent=room;
    document.getElementById('createHint').textContent='正在连接服务器…';
    _showStep('stepCreate');
    try{
      await OnlineGame.connect(room, name);
      document.getElementById('createHint').textContent='已连接，等待对手加入…';
    }
    catch(e){
      document.getElementById('createHint').textContent=e.message||'连接失败';
    }
  }

  /* ── 进入联机 - 加入房间 ─────────── */
  async function _joinRoom(){
    const name = document.getElementById('nameInput').value.trim() || '玩家';
    const room=document.getElementById('roomInput').value.trim();
    if(!room){ document.getElementById('joinHint').textContent='请输入房间号'; return; }
    document.getElementById('btnJoinConfirm').disabled=true;
    document.getElementById('joinHint').textContent='连接中…';
    try{ await OnlineGame.connect(room, name); }
    catch(e){
      document.getElementById('joinHint').textContent=e.message||'连接失败';
      document.getElementById('btnJoinConfirm').disabled=false;
    }
  }

  /* ── 显示游戏 UI ──────────────────── */
  function _showGameUI(isOnline){
    document.getElementById('lobby').style.display='none';
    document.getElementById('app').style.display='';
    elMyColorCard.style.display = isOnline?'':'none';
    elTimerCard.style.display   = isOnline?'':'none';
    elBtnLeave.style.display    = isOnline?'':'none';
    elBtnRestart.style.display  = isOnline?'none':'';
    elBtnUndo.style.display     = '';  // 本地和联机都显示悔棋
    elRoundInfo.style.display   = isOnline?'':'none';
    elRoomLabel.textContent     = isOnline?'':'本地对战';
    elHistoryList.innerHTML     = '';
    _hideModal();
  }

  function _updateScoreLabels(){
    if(mode==='online'){
      const names=OnlineGame.getNames();
      elBlackNameLabel.textContent = names.black || '黑棋';
      elWhiteNameLabel.textContent = names.white || '白棋';
      // 分数按玩家昵称存，换色后分数跟着玩家走
      const sc=OnlineGame.getScores();
      const bkScore = sc[names.black] != null ? sc[names.black] : (sc.black || 0);
      const wtScore = sc[names.white] != null ? sc[names.white] : (sc.white || 0);
      elBlackScore.textContent = bkScore;
      elWhiteScore.textContent = wtScore;
      elRoundText.textContent = '第 '+OnlineGame.getRoundNum()+' 局';
    } else {
      elBlackNameLabel.textContent = '黑棋';
      elWhiteNameLabel.textContent = '白棋';
      elBlackScore.textContent = scores.black;
      elWhiteScore.textContent = scores.white;
    }
  }

  /* ── 返回大厅 ─────────────────────── */
  function _exitToLobby(){
    mode = null;
    OnlineGame.close();
    TimerUI.stop();
    _unbindCanvas();
    document.getElementById('app').style.display='none';
    document.getElementById('lobby').style.display='';
    _showStep('stepMode');
  }

  /* ════════════════════════════════════════
     Canvas 事件绑定
     ════════════════════════════════════════ */
  function _unbindCanvas(){
    elCanvas.onmousemove=null; elCanvas.onmouseleave=null; elCanvas.onclick=null;
    hoverCell=null;
  }

  function _bindLocalCanvas(){
    _unbindCanvas();
    elCanvas.classList.remove('not-my-turn');
    elCanvas.onmousemove = (e)=>{
      if(LocalGame.isOver()) return;
      const g=Renderer.eventToGrid(e);
      if(g&&hoverCell&&g.col===hoverCell.col&&g.row===hoverCell.row) return;
      hoverCell=g;
      _renderLocal();
      if(g&&LocalGame.isEmpty(g.col,g.row)){
        Renderer.drawHover(g.col,g.row,LocalGame.getCurrent());
      }
    };
    elCanvas.onmouseleave = ()=>{ hoverCell=null; _renderLocal(); };
    elCanvas.onclick = (e)=>{
      if(LocalGame.isOver()) return;
      const g=Renderer.eventToGrid(e);
      if(!g) return;
      if(!LocalGame.isEmpty(g.col,g.row)){
        _showToast('此处已有棋子');
        return;
      }
      const result=LocalGame.place(g.col,g.row);
      if(!result.ok) return;
      AudioFX.play('place');
      const lastColor=LocalGame.getHistory()[LocalGame.getHistory().length-1].color;
      _addHistoryItem(g.col,g.row,lastColor);
      _renderLocal();
      if(result.win){
        AudioFX.play('win');
        _updateScore(lastColor===CONFIG.STONE.BLACK?'black':'white');
        _renderLocal();
        Renderer.drawWinLine(result.stones);
        setTimeout(()=>showModal(
          lastColor===CONFIG.STONE.BLACK?'black':'white', result.stones
        ),350);
        return;
      }
      if(result.draw){
        AudioFX.play('draw');
        scores.black=scores.black; scores.white=scores.white; // no change
        setTimeout(()=>showModal('draw'),350);
        return;
      }
      _updateLocalTurn();
    };
    elBtnRestart.onclick = ()=>{ AudioFX.play('click'); _enterLocal(); };
    elBtnUndo.onclick = ()=>{
      const m=LocalGame.undo();
      if(!m) return;
      AudioFX.play('undo');
      if(elHistoryList.lastElementChild) elHistoryList.removeChild(elHistoryList.lastElementChild);
      _renderLocal(); _updateLocalTurn();
    };
  }

  function _bindOnlineCanvas(){
    _unbindCanvas();
    elCanvas.classList.add('not-my-turn');
    elCanvas.onmousemove = (e)=>{
      if(OnlineGame.isOver()||!OnlineGame.isMyTurn()) return;
      const g=Renderer.eventToGrid(e);
      if(g&&hoverCell&&g.col===hoverCell.col&&g.row===hoverCell.row) return;
      hoverCell=g;
      _renderOnline();
      if(g&&OnlineGame.isEmpty(g.col,g.row)){
        Renderer.drawHover(g.col,g.row,OnlineGame.getMyColor());
      }
    };
    elCanvas.onmouseleave = ()=>{ hoverCell=null; _renderOnline(); };
    elCanvas.onclick = (e)=>{
      if(OnlineGame.isOver()) return;
      if(!OnlineGame.isMyTurn()){ _showToast('还不到你的回合'); return; }
      const g=Renderer.eventToGrid(e);
      if(!g) return;
      if(!OnlineGame.isEmpty(g.col,g.row)) return;
      OnlineGame.send('place',{col:g.col,row:g.row});
    };
    elBtnLeave.onclick = ()=>{ AudioFX.play('click'); _exitToLobby(); };
    elBtnUndo.onclick = ()=>{
      AudioFX.play('click');
      OnlineGame.requestUndo();
    };
  }

  /* ════════════════════════════════════════
     本地对战 UI
     ════════════════════════════════════════ */
  function _renderLocal(){
    Renderer.renderAll(LocalGame.getHistory());
  }

  function _updateLocalTurn(){
    const bk = LocalGame.getCurrent()===CONFIG.STONE.BLACK;
    elStonePreview.className='stone-preview '+(bk?'black':'white');
    elTurnText.textContent=(bk?'黑':'白')+'棋落子';
    elTurnIndicator.className='turn-indicator my-turn';
  }

  /* ════════════════════════════════════════
     联机对战 UI
     ════════════════════════════════════════ */
  function _renderOnline(){
    Renderer.renderAll(OnlineGame.getHistory());
  }

  function _setupOnlineUI(){
    OnlineGame.setupHandlers(
      /* onStart */
      (colorName, msg)=>{
        mode='online';  // 标记当前为联机模式
        const bk=colorName==='black';
        elMyStonePreview.className='stone-preview '+(bk?'black':'white');
        elMyColorName.textContent=bk?'黑棋':'白棋';
        elRoomLabel.textContent='房间：'+OnlineGame.getRoomName();
        _showGameUI(true);
        _bindOnlineCanvas();
        _updateScoreLabels();
        _renderOnline();
        elTurnText.textContent='等待服务端…';
        elTurnIndicator.className='turn-indicator';
        elStonePreview.className='stone-preview none';
        // 如果是再战后的新局，不弹窗，直接开始
        if(OnlineGame.getRoundNum() > 1){
          _hideModal();
        }
      },
      /* onTurn */
      (colorName, deadline)=>{
        const color=colorName==='black'?CONFIG.STONE.BLACK:CONFIG.STONE.WHITE;
        const mine=color===OnlineGame.getMyColor();
        const bk=color===CONFIG.STONE.BLACK;
        elStonePreview.className='stone-preview '+(bk?'black':'white');
        elTurnIndicator.className='turn-indicator '+(mine?'my-turn':'their-turn');
        elTurnText.textContent=mine?'轮到你落子':(bk?'黑':'白')+'棋落子中…';
        elCanvas.classList.toggle('not-my-turn',!mine);
        TimerUI.start(deadline);
      },
      /* onPlaced */
      (col,row,color)=>{
        AudioFX.play('place');
        _addHistoryItem(col,row,color);
        _renderOnline();
      },
      /* onGameOver */
      (winner,stones)=>{
        TimerUI.stop();
        elCanvas.classList.add('not-my-turn');
        _updateScoreLabels();
        if(stones&&stones.length){ _renderOnline(); Renderer.drawWinLine(stones); }
        AudioFX.play(winner==='draw'?'draw':(winner===OnlineGame.getMyColor()?'win':'lose'));
        setTimeout(()=>showModal(winner, stones),400);
      },
      /* onOpponentLeft */
      ()=>{
        TimerUI.stop();
        elTurnText.textContent='对手已断线';
        elTurnIndicator.className='turn-indicator';
        showModal('disconnect');
      },
      /* onWaiting */
      ()=>{
        document.getElementById('createHint').textContent='等待对手加入…';
      },
      /* onRematchRequest */
      (fromName)=>{
        // 对手申请再战，弹窗让用户选择
        _showRematchDialog(fromName);
      },
      /* onRematchResult */
      (accepted)=>{
        if(accepted){
          // 再战成功，start 消息会自动处理进入新局
        } else {
          // 对手拒绝，显示提示
          _showToast('对手拒绝了再战请求');
        }
      },
      /* onInfo */
      (msg)=>{
        _showToast(msg.msg);
      },
      /* onUndoRequest */
      (fromName)=>{
        _showUndoDialog(fromName);
      },
      /* onUndoDone */
      (moves)=>{
        // 移除落子记录最后两条
        for(let i = 0; i < (moves ? moves.length : 0); i++){
          if(elHistoryList.lastElementChild) elHistoryList.removeChild(elHistoryList.lastElementChild);
        }
        _renderOnline();
        _showToast('对方同意了悔棋');
      },
      /* onUndoRejected */
      ()=>{
        _showToast('对方拒绝了悔棋请求');
      }
    );
  }

  /* ════════════════════════════════════════
     通用 UI
     ════════════════════════════════════════ */
  function _addHistoryItem(col,row,color){
    const label=String.fromCharCode(65+col)+(row+1);
    const bk=color===CONFIG.STONE.BLACK;
    const idx = mode==='local'?LocalGame.getHistory().length:OnlineGame.getHistory().length;
    const li=document.createElement('li'); li.className='history-item';
    const dot=document.createElement('span'); dot.className='history-dot '+(bk?'black':'white');
    li.appendChild(dot);
    li.appendChild(document.createTextNode(idx+'. '+(bk?'黑':'白')+' '+label));
    elHistoryList.appendChild(li);
    elHistoryList.scrollTop=elHistoryList.scrollHeight;
  }

  function _updateScore(winner){
    if(winner==='black') scores.black++;
    else if(winner==='white') scores.white++;
    elBlackScore.textContent=scores.black;
    elWhiteScore.textContent=scores.white;
  }

  /* ── Toast 提示 ─────────────────────── */
  function _showToast(msg, duration){
    duration = duration || 3000;
    let el=document.getElementById('toast');
    if(!el){
      el=document.createElement('div');
      el.id='toast';
      el.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);'+
        'background:rgba(0,0,0,.8);color:#fff;padding:10px 24px;border-radius:8px;z-index:9999;'+
        'transition:opacity .3s;font-size:14px;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent=msg; el.style.opacity='1';
    setTimeout(()=>{ el.style.opacity='0'; }, duration);
  }

  /* ── 弹窗 ─────────────────────────── */
  function showModal(winner, stones){
    let title='', desc='', icon='';

    if(winner==='draw'){
      icon='🤝'; title='平局！'; desc='棋盘已满，双方平手！';
    } else if(winner==='disconnect'){
      icon='😢'; title='对手离开了'; desc='对方已断开连接';
    } else {
      const winColor = winner==='black'?'black':'white';
      if(mode==='online'){
        const names=OnlineGame.getNames();
        const winName = names[winColor] || (winner==='black'?'黑棋':'白棋');
        icon='🏆'; title=winName+' 获胜！';
        desc=winName+'率先连成五子！';
      } else {
        const winName = winner==='black'?'黑棋':'白棋';
        icon='🏆'; title=winName+' 获胜！';
        desc=winName+'率先连成五子！';
      }
    }

    elModalIcon.textContent=icon;
    elModalTitle.textContent=title;
    elModalDesc.textContent=desc;

    // 渲染按钮
    elModalBtnGroup.innerHTML='';
    if(mode==='online' && winner!=='disconnect'){
      // 联机模式：申请再战 + 返回大厅
      const btnRematch=document.createElement('button');
      btnRematch.className='btn btn-primary';
      btnRematch.textContent='申请再战';
      btnRematch.onclick=()=>{
        OnlineGame.requestRematch();
        btnRematch.disabled=true;
        btnRematch.textContent='等待对方同意…';
      };
      elModalBtnGroup.appendChild(btnRematch);
    } else if(mode==='local'){
      const btnAgain=document.createElement('button');
      btnAgain.className='btn btn-primary';
      btnAgain.textContent='再来一局';
      btnAgain.onclick=()=>{ _hideModal(); _enterLocal(); };
      elModalBtnGroup.appendChild(btnAgain);
    }

    const btnBack=document.createElement('button');
    btnBack.className='btn btn-secondary';
    btnBack.textContent='返回大厅';
    btnBack.onclick=()=>{ _hideModal(); _exitToLobby(); };
    elModalBtnGroup.appendChild(btnBack);

    elModalOverlay.classList.add('show');
  }

  /* ── 悔棋请求弹窗 ─────────────────────── */
  function _showUndoDialog(fromName){
    elModalIcon.textContent='↩️';
    elModalTitle.textContent=fromName+' 请求悔棋';
    elModalDesc.textContent='对方想撤回最近两步落子（对方一步 + 自己一步）';

    elModalBtnGroup.innerHTML='';
    const btnAccept=document.createElement('button');
    btnAccept.className='btn btn-primary';
    btnAccept.textContent='同意';
    btnAccept.onclick=()=>{
      OnlineGame.replyUndo(true);
      _hideModal();
    };
    elModalBtnGroup.appendChild(btnAccept);

    const btnReject=document.createElement('button');
    btnReject.className='btn btn-secondary';
    btnReject.textContent='拒绝';
    btnReject.onclick=()=>{
      OnlineGame.replyUndo(false);
      _hideModal();
    };
    elModalBtnGroup.appendChild(btnReject);

    elModalOverlay.classList.add('show');
  }

  /* ── 再战请求弹窗 ─────────────────────── */
  function _showRematchDialog(fromName){
    // 覆盖弹窗内容为再战请求
    elModalIcon.textContent='🤝';
    elModalTitle.textContent=fromName+' 邀请你再战一局';
    const nextRound = OnlineGame.getRoundNum() + 1;
    elModalDesc.textContent = (nextRound % CONFIG.SWAP_ROUNDS === 0)
      ? '下一局将交换黑白执子' : '';

    elModalBtnGroup.innerHTML='';
    const btnAccept=document.createElement('button');
    btnAccept.className='btn btn-primary';
    btnAccept.textContent='同意再战';
    btnAccept.onclick=()=>{
      OnlineGame.replyRematch(true);
      _hideModal();
    };
    elModalBtnGroup.appendChild(btnAccept);

    const btnReject=document.createElement('button');
    btnReject.className='btn btn-secondary';
    btnReject.textContent='返回大厅';
    btnReject.onclick=()=>{
      OnlineGame.replyRematch(false);
      _hideModal();
      _exitToLobby();
    };
    elModalBtnGroup.appendChild(btnReject);

    elModalOverlay.classList.add('show');
  }

  function _hideModal(){
    elModalOverlay.classList.remove('show');
  }

  return { init, _setupOnlineUI, showModal };
})();

/* ====================================================
   入口
   ==================================================== */
document.addEventListener('DOMContentLoaded',()=>{
  App.init();
  App._setupOnlineUI();
});
