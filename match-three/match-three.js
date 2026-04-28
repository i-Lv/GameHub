/* ===========================
   消消乐游戏逻辑
   =========================== */

class MatchThree {
  constructor() {
    this.board = [];
    this.boardSize = 8;
    this.numColors = 6;
    this.score = 0;
    this.currentLevel = 1;
    this.time = 60;
    this.maxTime = 60;
    this.selectedTile = null;
    this.gameStatus = 'idle'; // idle, playing, ended
    this.timer = null;

    // 关卡配置
    this.levels = this._defineLevels();

    // 关卡进度（localStorage）
    this.progress = this._loadProgress();

    this.init();
  }

  /* ===========================
     关卡定义
     =========================== */
  _defineLevels() {
    return [
      {
        id: 1,
        name: '初出茅庐',
        targetScore: 500,
        time: 90,
        numColors: 5,
        boardSize: 8,
        desc: '目标分数 500，轻松入门'
      }
      // 后续关卡在此扩展
    ];
  }

  _loadProgress() {
    try {
      const data = JSON.parse(localStorage.getItem('match3_progress'));
      if (data && typeof data.maxUnlocked === 'number') return data;
    } catch (e) {}
    return { maxUnlocked: 1, highScores: {} };
  }

  _saveProgress() {
    localStorage.setItem('match3_progress', JSON.stringify(this.progress));
  }

  _updateGameUI() {
    document.getElementById('score').textContent = this.score;
    document.getElementById('targetScore').textContent = this.targetScore;
    document.getElementById('time').textContent = this.time;
    document.getElementById('statusText').textContent = '游戏进行中';
  }

  getLevelConfig(levelId) {
    return this.levels.find(l => l.id === levelId) || this.levels[0];
  }

  /* ===========================
     初始化
     =========================== */
  init() {
    this.setupEventListeners();
    this.setupLobby();
  }

  setupEventListeners() {
    document.getElementById('btnRestart').addEventListener('click', () => this.restartGame());
    document.getElementById('btnHint').addEventListener('click', () => this.showHint());
    document.getElementById('btnBackLobby').addEventListener('click', () => this.backToLobby());
  }

  setupLobby() {
    // 开始游戏 —— 从第一关开始
    document.getElementById('btnStart').addEventListener('click', () => {
      this.startLevel(1);
    });

    // 选择关卡
    document.getElementById('btnSelectLevel').addEventListener('click', () => {
      this._renderLevelGrid();
      document.getElementById('stepMode').style.display = 'none';
      document.getElementById('stepLevels').style.display = '';
    });

    // 关卡选择返回
    document.getElementById('btnBackFromLevels').addEventListener('click', () => {
      document.getElementById('stepLevels').style.display = 'none';
      document.getElementById('stepMode').style.display = '';
    });
  }

  _renderLevelGrid() {
    const grid = document.getElementById('levelGrid');
    grid.innerHTML = '';
    this.levels.forEach(level => {
      const unlocked = level.id <= this.progress.maxUnlocked;
      const highScore = this.progress.highScores[level.id] || 0;
      const passed = highScore >= level.targetScore;

      const card = document.createElement('div');
      card.className = 'level-card' + (unlocked ? '' : ' locked');
      card.innerHTML = `
        <div class="level-card-num">${unlocked ? level.id : '<span class="lock-icon">🔒</span>'}</div>
        <div class="level-card-name">${level.name}</div>
        <div class="level-card-desc">${level.desc}</div>
        ${passed ? '<div class="level-card-badge">⭐ 已通关</div>' : ''}
        ${highScore > 0 && !passed ? '<div class="level-card-score">最高：' + highScore + '</div>' : ''}
      `;
      if (unlocked) {
        card.addEventListener('click', () => this.startLevel(level.id));
      }
      grid.appendChild(card);
    });
  }

  /* ===========================
     开始关卡
     =========================== */
  startLevel(levelId) {
    const config = this.getLevelConfig(levelId);
    if (!config) return;

    this.currentLevel = levelId;
    this.boardSize = config.boardSize;
    this.numColors = config.numColors;
    this.maxTime = config.time;
    this.score = 0;
    this.time = config.time;
    this.selectedTile = null;
    this.gameStatus = 'playing';
    this.targetScore = config.targetScore;

    // 生成无初始匹配的棋盘
    this.generateBoard();

    // 更新 UI
    this._updateGameUI();
    this.drawBoard();
    this.startTimer();

    // 切换到游戏界面
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('app').style.display = '';
    document.getElementById('levelSubtitle').textContent = '第 ' + levelId + ' 关 — ' + config.name;
    document.getElementById('targetScore').textContent = config.targetScore;
  }

  /* ===========================
     棋盘生成
     =========================== */
  generateBoard() {
    this.board = [];
    for (let i = 0; i < this.boardSize; i++) {
      this.board[i] = [];
      for (let j = 0; j < this.boardSize; j++) {
        let color;
        do {
          color = Math.floor(Math.random() * this.numColors) + 1;
        } while (this.wouldCreateMatch(i, j, color));
        this.board[i][j] = color;
      }
    }
  }

  wouldCreateMatch(row, col, color) {
    // 水平方向
    if (col >= 2) {
      if (this.board[row][col - 1] === color && this.board[row][col - 2] === color) {
        return true;
      }
    }
    // 垂直方向
    if (row >= 2) {
      if (this.board[row - 1][col] === color && this.board[row - 2][col] === color) {
        return true;
      }
    }
    return false;
  }

  /* ===========================
     棋盘绘制
     =========================== */
  drawBoard() {
    const gameBoard = document.getElementById('gameBoard');
    gameBoard.innerHTML = '';

    for (let i = 0; i < this.boardSize; i++) {
      for (let j = 0; j < this.boardSize; j++) {
        const tile = document.createElement('div');
        tile.className = 'tile color-' + this.board[i][j];
        tile.dataset.row = i;
        tile.dataset.col = j;
        tile.textContent = this.getTileSymbol(this.board[i][j]);
        tile.addEventListener('click', () => this.handleTileClick(i, j));
        gameBoard.appendChild(tile);
      }
    }

    // 根据棋盘大小更新 CSS grid
    gameBoard.style.gridTemplateColumns = 'repeat(' + this.boardSize + ', 60px)';
    gameBoard.style.gridTemplateRows = 'repeat(' + this.boardSize + ', 60px)';
  }

  getTileSymbol(color) {
    const symbols = ['🎈', '🎯', '🎨', '🎭', '🎪', '🎡'];
    return symbols[color - 1] || '🎈';
  }

  /* ===========================
     交互逻辑
     =========================== */
  handleTileClick(row, col) {
    if (this.gameStatus !== 'playing') return;

    if (!this.selectedTile) {
      this.selectedTile = { row, col };
      const tile = document.querySelector('.tile[data-row="' + row + '"][data-col="' + col + '"]');
      if (tile) tile.classList.add('selected');
    } else {
      if (this.selectedTile.row === row && this.selectedTile.col === col) {
        // 取消选择
        const tile = document.querySelector('.tile[data-row="' + row + '"][data-col="' + col + '"]');
        if (tile) tile.classList.remove('selected');
        this.selectedTile = null;
        return;
      }

      if (this.areAdjacent(this.selectedTile, { row, col })) {
        this.swapTiles(this.selectedTile.row, this.selectedTile.col, row, col);

        const matches = this.findMatches();
        if (matches.length > 0) {
          this.removeMatches(matches);
          this.updateScore(matches.length * 10);
          this.processBoard();
        } else {
          // 无匹配，交换回来
          this.swapTiles(row, col, this.selectedTile.row, this.selectedTile.col);
        }

        const selTile = document.querySelector('.tile.selected');
        if (selTile) selTile.classList.remove('selected');
        this.selectedTile = null;
      } else {
        // 不相邻，重新选择
        const oldTile = document.querySelector('.tile.selected');
        if (oldTile) oldTile.classList.remove('selected');
        this.selectedTile = { row, col };
        const tile = document.querySelector('.tile[data-row="' + row + '"][data-col="' + col + '"]');
        if (tile) tile.classList.add('selected');
      }
    }
  }

  processBoard() {
    let maxIterations = 50;
    var newMatches;
    do {
      this.dropTiles();
      this.fillEmptyTiles();
      this.drawBoard();
      maxIterations--;
      newMatches = this.findMatches();
      if (newMatches.length > 0) {
        this.removeMatches(newMatches);
        this.updateScore(newMatches.length * 10);
      }
    } while (newMatches.length > 0 && maxIterations > 0);

    // 检查是否有可行移动
    if (!this.hasValidMoves()) {
      this.shuffleBoard();
    }

    // 检查是否达到目标分数（过关）
    if (this.score >= this.targetScore && this.gameStatus === 'playing') {
      this.levelComplete();
    }
  }

  hasValidMoves() {
    for (let i = 0; i < this.boardSize; i++) {
      for (let j = 0; j < this.boardSize; j++) {
        if (j < this.boardSize - 1) {
          this._swapData(i, j, i, j + 1);
          if (this.findMatches().length > 0) {
            this._swapData(i, j, i, j + 1);
            return true;
          }
          this._swapData(i, j, i, j + 1);
        }
        if (i < this.boardSize - 1) {
          this._swapData(i, j, i + 1, j);
          if (this.findMatches().length > 0) {
            this._swapData(i, j, i + 1, j);
            return true;
          }
          this._swapData(i, j, i + 1, j);
        }
      }
    }
    return false;
  }

  shuffleBoard() {
    let attempts = 0;
    do {
      const flat = [];
      for (let i = 0; i < this.boardSize; i++)
        for (let j = 0; j < this.boardSize; j++)
          flat.push(this.board[i][j]);
      for (let k = flat.length - 1; k > 0; k--) {
        const r = Math.floor(Math.random() * (k + 1));
        [flat[k], flat[r]] = [flat[r], flat[k]];
      }
      let idx = 0;
      for (let i = 0; i < this.boardSize; i++)
        for (let j = 0; j < this.boardSize; j++)
          this.board[i][j] = flat[idx++];
      attempts++;
    } while ((this.findMatches().length > 0 || !this.hasValidMoves()) && attempts < 100);

    if (attempts >= 100) {
      this.generateBoard();
    }
    this.drawBoard();
  }

  _swapData(row1, col1, row2, col2) {
    const temp = this.board[row1][col1];
    this.board[row1][col1] = this.board[row2][col2];
    this.board[row2][col2] = temp;
  }

  areAdjacent(tile1, tile2) {
    const rowDiff = Math.abs(tile1.row - tile2.row);
    const colDiff = Math.abs(tile1.col - tile2.col);
    return (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
  }

  swapTiles(row1, col1, row2, col2) {
    this._swapData(row1, col1, row2, col2);
    this.drawBoard();
  }

  /* ===========================
     匹配检测
     =========================== */
  findMatches() {
    const matches = [];

    // 水平匹配
    for (let i = 0; i < this.boardSize; i++) {
      let count = 1;
      for (let j = 1; j < this.boardSize; j++) {
        if (this.board[i][j] === this.board[i][j - 1]) {
          count++;
        } else {
          if (count >= 3) {
            for (let k = j - count; k < j; k++) {
              matches.push({ row: i, col: k });
            }
          }
          count = 1;
        }
      }
      if (count >= 3) {
        for (let k = this.boardSize - count; k < this.boardSize; k++) {
          matches.push({ row: i, col: k });
        }
      }
    }

    // 垂直匹配
    for (let j = 0; j < this.boardSize; j++) {
      let count = 1;
      for (let i = 1; i < this.boardSize; i++) {
        if (this.board[i][j] === this.board[i - 1][j]) {
          count++;
        } else {
          if (count >= 3) {
            for (let k = i - count; k < i; k++) {
              matches.push({ row: k, col: j });
            }
          }
          count = 1;
        }
      }
      if (count >= 3) {
        for (let k = this.boardSize - count; k < this.boardSize; k++) {
          matches.push({ row: k, col: j });
        }
      }
    }

    return matches;
  }

  removeMatches(matches) {
    matches.forEach(match => {
      this.board[match.row][match.col] = null;
    });
    this.drawBoard();

    matches.forEach(match => {
      const tile = document.querySelector('.tile[data-row="' + match.row + '"][data-col="' + match.col + '"]');
      if (tile) {
        tile.classList.add('matching');
      }
    });
  }

  dropTiles() {
    for (let j = 0; j < this.boardSize; j++) {
      let emptyRow = this.boardSize - 1;
      for (let i = this.boardSize - 1; i >= 0; i--) {
        if (this.board[i][j] !== null) {
          this.board[emptyRow][j] = this.board[i][j];
          if (emptyRow !== i) {
            this.board[i][j] = null;
          }
          emptyRow--;
        }
      }
    }
  }

  fillEmptyTiles() {
    for (let i = 0; i < this.boardSize; i++) {
      for (let j = 0; j < this.boardSize; j++) {
        if (this.board[i][j] === null) {
          this.board[i][j] = Math.floor(Math.random() * this.numColors) + 1;
        }
      }
    }
  }

  /* ===========================
     提示
     =========================== */
  showHint() {
    if (this.gameStatus !== 'playing') return;

    for (let i = 0; i < this.boardSize; i++) {
      for (let j = 0; j < this.boardSize; j++) {
        if (j < this.boardSize - 1) {
          this._swapData(i, j, i, j + 1);
          if (this.findMatches().length > 0) {
            this._swapData(i, j, i, j + 1);
            const tile = document.querySelector('.tile[data-row="' + i + '"][data-col="' + j + '"]');
            if (tile) {
              tile.style.animation = 'hint 1s ease infinite';
              setTimeout(() => { tile.style.animation = ''; }, 3000);
            }
            return;
          }
          this._swapData(i, j, i, j + 1);
        }

        if (i < this.boardSize - 1) {
          this._swapData(i, j, i + 1, j);
          if (this.findMatches().length > 0) {
            this._swapData(i, j, i + 1, j);
            const tile = document.querySelector('.tile[data-row="' + i + '"][data-col="' + j + '"]');
            if (tile) {
              tile.style.animation = 'hint 1s ease infinite';
              setTimeout(() => { tile.style.animation = ''; }, 3000);
            }
            return;
          }
          this._swapData(i, j, i + 1, j);
        }
      }
    }
    this.shuffleBoard();
  }

  /* ===========================
     分数 & 过关
     =========================== */
  updateScore(points) {
    this.score += points;
    document.getElementById('score').textContent = this.score;
  }

  levelComplete() {
    this.gameStatus = 'ended';
    this.stopTimer();

    // 保存进度
    const prev = this.progress.highScores[this.currentLevel] || 0;
    if (this.score > prev) {
      this.progress.highScores[this.currentLevel] = this.score;
    }
    // 解锁下一关
    if (this.currentLevel >= this.progress.maxUnlocked) {
      const nextId = this.currentLevel + 1;
      if (nextId <= this.levels.length) {
        this.progress.maxUnlocked = nextId;
      }
    }
    this._saveProgress();

    // 显示过关弹窗
    document.getElementById('modalIcon').textContent = '🏆';
    document.getElementById('modalTitle').textContent = '恭喜过关！';
    document.getElementById('modalDesc').textContent = '第 ' + this.currentLevel + ' 关完成！得分：' + this.score;
    this.showModal(true);
  }

  /* ===========================
     计时器
     =========================== */
  startTimer() {
    this.stopTimer();
    document.getElementById('time').textContent = this.time;

    this.timer = setInterval(() => {
      this.time--;
      document.getElementById('time').textContent = this.time;

      if (this.time <= 0) {
        this.stopTimer();
        this.endGame();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /* ===========================
     游戏结束
     =========================== */
  endGame() {
    this.gameStatus = 'ended';
    this.stopTimer();

    // 保存最高分（即使没过关）
    const prev = this.progress.highScores[this.currentLevel] || 0;
    if (this.score > prev) {
      this.progress.highScores[this.currentLevel] = this.score;
      this._saveProgress();
    }

    document.getElementById('modalIcon').textContent = '😢';
    document.getElementById('modalTitle').textContent = '时间到！';
    document.getElementById('modalDesc').textContent = '得分：' + this.score + ' / 目标：' + this.targetScore;
    this.showModal(false);
  }

  showModal(isWin) {
    const modalOverlay = document.getElementById('modalOverlay');
    const modalBtnGroup = document.getElementById('modalBtnGroup');
    modalBtnGroup.innerHTML = '';

    // 再来一次（重试当前关）
    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn btn-primary';
    restartBtn.textContent = '再来一次';
    restartBtn.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
      this.startLevel(this.currentLevel);
    });
    modalBtnGroup.appendChild(restartBtn);

    // 过关后可以进入下一关
    if (isWin && this.currentLevel < this.levels.length) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn btn-primary';
      nextBtn.textContent = '下一关';
      nextBtn.addEventListener('click', () => {
        modalOverlay.classList.remove('active');
        this.startLevel(this.currentLevel + 1);
      });
      modalBtnGroup.appendChild(nextBtn);
    }

    // 返回大厅
    const lobbyBtn = document.createElement('button');
    lobbyBtn.className = 'btn btn-secondary';
    lobbyBtn.textContent = '返回大厅';
    lobbyBtn.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
      this.backToLobby();
    });
    modalBtnGroup.appendChild(lobbyBtn);

    modalOverlay.classList.add('active');
  }

  restartGame() {
    this.startLevel(this.currentLevel);
  }

  backToLobby() {
    this.stopTimer();
    this.gameStatus = 'idle';
    document.getElementById('app').style.display = 'none';
    document.getElementById('lobby').style.display = '';
    document.getElementById('stepMode').style.display = '';
    document.getElementById('stepLevels').style.display = 'none';
  }
}

// 初始化游戏
window.addEventListener('load', () => {
  new MatchThree();
});

// 提示动画
const style = document.createElement('style');
style.textContent = `
  @keyframes hint {
    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(240, 192, 64, 0.4); }
    70% { transform: scale(1.1); box-shadow: 0 0 0 10px rgba(240, 192, 64, 0); }
    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(240, 192, 64, 0); }
  }
`;
document.head.appendChild(style);
