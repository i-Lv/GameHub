/* ===========================
   井字棋游戏逻辑
   =========================== */

class TicTacToe {
  constructor() {
    this.canvas = document.getElementById('board');
    this.ctx = this.canvas.getContext('2d');
    this.gridSize = 3;
    this.board = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(null));
    this.currentPlayer = 'X';
    this.gameMode = null;
    this.gameStatus = 'idle'; // idle, playing, ended
    this.history = [];
    this.players = {
      X: { name: 'X 方', score: 0 },
      O: { name: 'O 方', score: 0 }
    };
    this.round = 1;
    this.timer = null;
    this.timeLeft = 30;
    this.socket = null;
    this.roomId = null;
    this.mySymbol = null;
    this.opponentName = null;
    this._resizeCanvas();
    this.init();
    window.addEventListener('resize', () => this._resizeCanvas());
  }

  _resizeCanvas() {
    const container = this.canvas.parentElement;
    const size = Math.min(container.clientWidth, container.clientHeight || 450, 450);
    if (size <= 0) return; // 容器尚未可见，跳过
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cellSize = size / this.gridSize;
    this.drawBoard();
  }

  init() {
    this.setupEventListeners();
    this.setupLobby();
  }

  setupEventListeners() {
    // 棋盘点击事件
    this.canvas.addEventListener('click', (e) => this.handleBoardClick(e));

    // 按钮事件
    document.getElementById('btnRestart').addEventListener('click', () => this.restartGame());
    document.getElementById('btnUndo').addEventListener('click', () => this.undoMove());
    document.getElementById('btnBackLobby').addEventListener('click', () => this.backToLobby());
    document.getElementById('btnLeave').addEventListener('click', () => this.leaveRoom());
  }

  setupLobby() {
    // 模式选择
    document.getElementById('btnLocal').addEventListener('click', () => this.startLocalGame());
    document.getElementById('btnOnline').addEventListener('click', () => {
      document.getElementById('stepMode').style.display = 'none';
      document.getElementById('stepOnline').style.display = '';
    });

    // 返回按钮
    document.getElementById('btnBackMode').addEventListener('click', () => {
      document.getElementById('stepOnline').style.display = 'none';
      document.getElementById('stepMode').style.display = '';
    });

    // 创建房间
    document.getElementById('btnCreate').addEventListener('click', () => {
      document.getElementById('stepOnline').style.display = 'none';
      document.getElementById('stepName').style.display = '';
      document.getElementById('btnNameConfirm').onclick = () => this.createRoom();
    });

    // 加入房间
    document.getElementById('btnJoin').addEventListener('click', () => {
      document.getElementById('stepOnline').style.display = 'none';
      document.getElementById('stepName').style.display = '';
      document.getElementById('btnNameConfirm').onclick = () => this.joinRoom();
    });

    // 返回输入昵称
    document.getElementById('btnBackFromName').addEventListener('click', () => {
      document.getElementById('stepName').style.display = 'none';
      document.getElementById('stepOnline').style.display = '';
    });

    // 加入房间确认
    document.getElementById('btnJoinConfirm').addEventListener('click', () => this.confirmJoinRoom());

    // 复制房间号
    document.getElementById('btnCopy').addEventListener('click', () => {
      const roomCode = document.getElementById('roomCode').textContent;
      navigator.clipboard.writeText(roomCode);
      alert('房间号已复制到剪贴板');
    });
  }

  startLocalGame() {
    this.gameMode = 'local';
    this.gameStatus = 'playing';
    this.board = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(null));
    this.currentPlayer = 'X';
    this.history = [];
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('app').style.display = '';
    // 必须先显示 app，再 resize canvas（否则 clientWidth 为 0）
    this._resizeCanvas();
    this.updateUI();
    this.drawBoard();
  }

  createRoom() {
    const name = document.getElementById('nameInput').value.trim() || '玩家';
    if (!name) {
      alert('请输入昵称');
      return;
    }

    this.players.X.name = name;
    document.getElementById('stepName').style.display = 'none';
    document.getElementById('stepCreate').style.display = '';

    // 生成房间号
    this.roomId = 'TIC' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    document.getElementById('roomCode').textContent = this.roomId;
    document.getElementById('createHint').textContent = '等待对手加入...';

    // 真正的 WebSocket 连接
    this._connectWS(this.roomId, name);
  }

  joinRoom() {
    const name = document.getElementById('nameInput').value.trim() || '玩家';
    if (!name) {
      alert('请输入昵称');
      return;
    }

    this.myName = name;
    document.getElementById('stepName').style.display = 'none';
    document.getElementById('stepJoin').style.display = '';
  }

  confirmJoinRoom() {
    const roomId = document.getElementById('roomInput').value.trim();
    if (!roomId) {
      alert('请输入房间号');
      return;
    }

    this.roomId = roomId;
    const name = document.getElementById('nameInput').value.trim() || '玩家';
    this._connectWS(roomId, name);
  }

  _connectWS(roomId, name) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws-tictactoe`;
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      this.socket.send(JSON.stringify({ type: 'join', room: roomId, name: name }));
    };

    this.socket.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      this._handleServerMsg(msg);
    };

    this.socket.onerror = () => {
      alert('连接失败，请检查网络');
    };

    this.socket.onclose = () => {
      if (this.gameMode === 'online' && this.gameStatus === 'playing') {
        alert('连接断开');
      }
      this.socket = null;
    };
  }

  _handleServerMsg(msg) {
    switch (msg.type) {
      case 'waiting':
        // 已在 stepCreate 界面，createHint 已显示等待
        break;

      case 'start':
        this.mySymbol = msg.symbol;
        this.players.X.name = msg.names.X;
        this.players.O.name = msg.names.O;
        this.round = msg.round;
        if (msg.scores) {
          for (const [k, v] of Object.entries(msg.scores)) {
            if (this.players.X.name === k) this.players.X.score = v;
            if (this.players.O.name === k) this.players.O.score = v;
          }
        }
        this.board = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(null));
        this.currentPlayer = 'X';
        this.history = [];
        this.startOnlineGame(msg.symbol);
        break;

      case 'turn':
        this.currentPlayer = msg.symbol;
        this.timeLeft = 30;
        this.startTimer();
        this.updateUI();
        break;

      case 'placed':
        this.board[msg.row][msg.col] = msg.symbol;
        this.history.push({ row: msg.row, col: msg.col, player: msg.symbol });
        this.drawBoard();
        this.updateHistory();
        break;

      case 'over':
        this.gameStatus = 'ended';
        this.stopTimer();
        if (msg.winner === 'draw') {
          document.getElementById('modalTitle').textContent = '平局！';
          document.getElementById('modalDesc').textContent = '棋盘已满，无人获胜';
        } else {
          const winnerName = msg.winner_name || this.players[msg.winner].name;
          this.players[msg.winner].score++;
          document.getElementById('modalTitle').textContent = `${winnerName} 获胜！`;
          document.getElementById('modalDesc').textContent = '恭喜连成一线！';
        }
        this.updateScore();
        this.showModal();
        break;

      case 'opponent_left':
        this.gameStatus = 'ended';
        this.stopTimer();
        alert('对手已离开');
        this.backToLobby();
        break;

      case 'rematch_request':
        if (confirm(`${msg.from} 请求再战，是否同意？`)) {
          this.socket.send(JSON.stringify({ type: 'rematch_reply', accept: true }));
        } else {
          this.socket.send(JSON.stringify({ type: 'rematch_reply', accept: false }));
        }
        break;

      case 'rematch_result':
        if (msg.accepted) {
          document.getElementById('modalOverlay').classList.remove('active');
        } else {
          alert('对手拒绝了再战请求');
          document.getElementById('modalOverlay').classList.remove('active');
        }
        break;

      case 'undo_request':
        if (confirm(`${msg.from} 请求悔棋，是否同意？`)) {
          this.socket.send(JSON.stringify({ type: 'undo_reply', accept: true }));
        } else {
          this.socket.send(JSON.stringify({ type: 'undo_reply', accept: false }));
        }
        break;

      case 'undo_done':
        msg.moves.forEach(m => {
          this.board[m.row][m.col] = null;
          const idx = this.history.findIndex(h => h.row === m.row && h.col === m.col);
          if (idx !== -1) this.history.splice(idx, 1);
        });
        this.drawBoard();
        this.updateHistory();
        break;

      case 'error':
        alert(msg.msg);
        break;
    }
  }

  startOnlineGame(symbol) {
    this.gameMode = 'online';
    this.gameStatus = 'playing';
    this.board = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(null));
    this.currentPlayer = 'X';
    this.history = [];
    this.mySymbol = symbol;
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('app').style.display = '';
    document.getElementById('myColorCard').style.display = '';
    document.getElementById('timerCard').style.display = '';
    document.getElementById('btnLeave').style.display = '';
    document.getElementById('roundInfo').style.display = '';
    document.getElementById('turnIndicator').style.display = 'none';
    document.getElementById('mySymbolPreview').textContent = symbol === 'X' ? '❌' : '⭕';
    document.getElementById('myColorName').textContent = symbol === 'X' ? 'X 方' : 'O 方';
    document.getElementById('roomLabel').textContent = '房间: ${this.roomId}';
    document.getElementById('roundText').textContent = '第 ${this.round} 局';
    // 必须先显示 app，再 resize canvas
    this._resizeCanvas();
    this.updateUI();
    this.drawBoard();
  }

  makeMove(row, col) {
    this.board[row][col] = this.currentPlayer;
    this.history.push({ row, col, player: this.currentPlayer });
    this.drawBoard();
    this.updateHistory();

    if (this.checkWin(row, col)) {
      this.endGame(this.currentPlayer);
    } else if (this.checkDraw()) {
      this.endGame('draw');
    } else {
      this.switchPlayer();
    }
  }

  handleBoardClick(e) {
    if (this.gameStatus !== 'playing') return;
    if (this.gameMode === 'online' && this.currentPlayer !== this.mySymbol) return;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.cellSize / (rect.width / this.gridSize);
    const scaleY = this.cellSize / (rect.height / this.gridSize);
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    if (row < 0 || row >= this.gridSize || col < 0 || col >= this.gridSize) return;
    if (this.board[row][col] !== null) return;

    if (this.gameMode === 'online' && this.socket) {
      this.socket.send(JSON.stringify({ type: 'place', row: row, col: col }));
    } else {
      this.makeMove(row, col);
    }
  }

  checkWin(row, col) {
    const player = this.board[row][col];

    // 检查行
    if (this.board[row].every(cell => cell === player)) {
      return true;
    }

    // 检查列
    let colWin = true;
    for (let i = 0; i < this.gridSize; i++) {
      if (this.board[i][col] !== player) {
        colWin = false;
        break;
      }
    }
    if (colWin) return true;

    // 检查对角线
    if (row === col) {
      let diagWin = true;
      for (let i = 0; i < this.gridSize; i++) {
        if (this.board[i][i] !== player) {
          diagWin = false;
          break;
        }
      }
      if (diagWin) return true;
    }

    // 检查反对角线
    if (row + col === this.gridSize - 1) {
      let antiDiagWin = true;
      for (let i = 0; i < this.gridSize; i++) {
        if (this.board[i][this.gridSize - 1 - i] !== player) {
          antiDiagWin = false;
          break;
        }
      }
      if (antiDiagWin) return true;
    }

    return false;
  }

  checkDraw() {
    for (let i = 0; i < this.gridSize; i++) {
      for (let j = 0; j < this.gridSize; j++) {
        if (this.board[i][j] === null) {
          return false;
        }
      }
    }
    return true;
  }

  switchPlayer() {
    this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
    this.updateUI();
  }

  endGame(winner) {
    this.gameStatus = 'ended';
    this.stopTimer();

    if (winner === 'draw') {
      document.getElementById('modalTitle').textContent = '平局！';
      document.getElementById('modalDesc').textContent = '棋盘已满，无人获胜';
    } else {
      // 联机模式下分数由服务器管理，不重复加分
      if (this.gameMode !== 'online') {
        this.players[winner].score++;
      }
      document.getElementById('modalTitle').textContent = `${this.players[winner].name} 获胜！`;
      document.getElementById('modalDesc').textContent = '恭喜连成一线！';
    }

    this.updateScore();
    this.showModal();
  }

  showModal() {
    const modalOverlay = document.getElementById('modalOverlay');
    const modalBtnGroup = document.getElementById('modalBtnGroup');
    modalBtnGroup.innerHTML = '';

    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn btn-primary';
    restartBtn.textContent = '再来一局';
    restartBtn.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
      this.restartGame();
    });

    const lobbyBtn = document.createElement('button');
    lobbyBtn.className = 'btn btn-secondary';
    lobbyBtn.textContent = '返回大厅';
    lobbyBtn.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
      this.backToLobby();
    });

    modalBtnGroup.appendChild(restartBtn);
    modalBtnGroup.appendChild(lobbyBtn);
    modalOverlay.classList.add('active');
  }

  restartGame() {
    this.board = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(null));
    this.currentPlayer = 'X';
    this.history = [];
    this.gameStatus = 'playing';
    this.updateUI();
    this.drawBoard();
    this.updateHistory();
    if (this.gameMode === 'online') {
      this.round++;
      document.getElementById('roundText').textContent = `第 ${this.round} 局`;
      this.startTimer();
    }
  }

  undoMove() {
    if (this.history.length === 0) return;

    const lastMove = this.history.pop();
    this.board[lastMove.row][lastMove.col] = null;
    this.currentPlayer = lastMove.player;
    this.updateUI();
    this.drawBoard();
    this.updateHistory();
  }

  backToLobby() {
    this.stopTimer();
    this.gameStatus = 'idle';
    document.getElementById('app').style.display = 'none';
    document.getElementById('lobby').style.display = '';
    document.getElementById('stepMode').style.display = '';
    document.getElementById('stepName').style.display = 'none';
    document.getElementById('stepOnline').style.display = 'none';
    document.getElementById('stepCreate').style.display = 'none';
    document.getElementById('stepJoin').style.display = 'none';
  }

  leaveRoom() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.backToLobby();
  }

  drawBoard() {
    const size = parseFloat(this.canvas.style.width) || 450;
    this.ctx.clearRect(0, 0, size, size);

    // 绘制棋盘
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.lineWidth = 2;

    for (let i = 1; i < this.gridSize; i++) {
      // 水平线
      this.ctx.beginPath();
      this.ctx.moveTo(0, i * this.cellSize);
      this.ctx.lineTo(size, i * this.cellSize);
      this.ctx.stroke();

      // 垂直线
      this.ctx.beginPath();
      this.ctx.moveTo(i * this.cellSize, 0);
      this.ctx.lineTo(i * this.cellSize, size);
      this.ctx.stroke();
    }

    // 绘制棋子
    for (let i = 0; i < this.gridSize; i++) {
      for (let j = 0; j < this.gridSize; j++) {
        if (this.board[i][j]) {
          this.drawSymbol(i, j, this.board[i][j]);
        }
      }
    }
  }

  drawSymbol(row, col, symbol) {
    const x = col * this.cellSize + this.cellSize / 2;
    const y = row * this.cellSize + this.cellSize / 2;

    this.ctx.font = '48px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = symbol === 'X' ? '#e94560' : '#f0c040';
    this.ctx.fillText(symbol === 'X' ? '❌' : '⭕', x, y);
  }

  updateUI() {
    document.getElementById('turnText').textContent = `${this.players[this.currentPlayer].name} 落子`;
    document.getElementById('symbolPreview').textContent = this.currentPlayer === 'X' ? '❌' : '⭕';
    this.updateScore();
  }

  updateScore() {
    document.getElementById('xScore').textContent = this.players.X.score;
    document.getElementById('oScore').textContent = this.players.O.score;
    document.getElementById('xNameLabel').textContent = this.players.X.name;
    document.getElementById('oNameLabel').textContent = this.players.O.name;
  }

  updateHistory() {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';

    this.history.forEach((move, index) => {
      const li = document.createElement('li');
      li.textContent = `${index + 1}. ${move.player} (${move.row + 1}, ${move.col + 1})`;
      historyList.appendChild(li);
    });

    // 滚动到底部
    historyList.scrollTop = historyList.scrollHeight;
  }

  startTimer() {
    this.stopTimer();
    this.timeLeft = 30;
    document.getElementById('timerNum').textContent = this.timeLeft;

    // 初始化进度环
    const circumference = 2 * Math.PI * 34;
    const timerArc = document.getElementById('timerArc');
    timerArc.style.strokeDasharray = circumference;
    timerArc.style.strokeDashoffset = '0';

    this.timer = setInterval(() => {
      this.timeLeft--;
      document.getElementById('timerNum').textContent = this.timeLeft;

      // 更新进度条
      const percentage = (this.timeLeft / 30) * 100;
      const offset = circumference - (percentage / 100) * circumference;
      document.getElementById('timerArc').style.strokeDashoffset = offset;

      if (this.timeLeft <= 0) {
        this.stopTimer();
        // 超时：当前玩家输
        if (this.gameMode === 'online' && this.currentPlayer === this.mySymbol) {
          // 自己超时，等服务器自动处理
        } else if (this.gameMode === 'local') {
          this.endGame(this.currentPlayer === 'X' ? 'O' : 'X');
        }
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// 初始化游戏
window.addEventListener('load', () => {
  new TicTacToe();
});