/**
 * Baba Is You 中文版 — 游戏主循环
 * 输入处理、关卡选择、胜利/失败弹窗
 */

(function () {
  'use strict';

  const engine = new GameEngine();
  let renderer = null;
  let currentLevelIndex = 0;
  let gameState = 'menu'; // menu | playing | win | lose
  let lastRenderTime = 0;
  let completedLevels = new Set();

  // 读取本地存储的通关记录
  try {
    const saved = JSON.parse(localStorage.getItem('baba_completed') || '[]');
    completedLevels = new Set(saved);
  } catch (e) {}

  // ==================== DOM ====================

  const canvas = document.getElementById('gameCanvas');
  const menuOverlay = document.getElementById('menuOverlay');
  const winOverlay = document.getElementById('winOverlay');
  const loseOverlay = document.getElementById('loseOverlay');
  const levelCards = document.getElementById('levelCards');

  // ==================== 初始化 ====================

  function init() {
    renderer = new Renderer(canvas);
    renderer.resize();
    buildLevelSelect();
    showMenu();
    requestAnimationFrame(gameLoop);
  }

  // ==================== 关卡选择 ====================

  function buildLevelSelect() {
    levelCards.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const card = document.createElement('div');
      card.className = 'level-card';
      if (completedLevels.has(i)) card.classList.add('completed');
      card.innerHTML = `
        <div class="card-num">第 ${i + 1} 关</div>
        <div class="card-name">${lv.name}</div>
        <div class="card-name-en">${lv.nameEn}</div>
      `;
      card.addEventListener('click', () => startLevel(i));
      levelCards.appendChild(card);
    });
  }

  // 检测是否为触摸设备
  function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  function showMenu() {
    gameState = 'menu';
    menuOverlay.style.display = 'flex';
    winOverlay.style.display = 'none';
    loseOverlay.style.display = 'none';
    dpad.style.display = 'none';
    mobileActions.style.display = 'none';
  }

  function hideAllOverlays() {
    menuOverlay.style.display = 'none';
    winOverlay.style.display = 'none';
    loseOverlay.style.display = 'none';
  }

  // ==================== 关卡控制 ====================

  function startLevel(index) {
    currentLevelIndex = index;
    hideAllOverlays();
    gameState = 'playing';
    engine.loadLevel(LEVELS[index]);
    renderer.calcLayout(engine.grid);

    // 更新关卡名称
    document.getElementById('currentLevelName').textContent = `第${index + 1}关 · ${LEVELS[index].name}`;
    document.getElementById('currentLevelHint').textContent = LEVELS[index].hint;
    document.getElementById('gameUI').style.display = 'block';
    // 触摸设备始终显示方向键，不依赖 CSS 媒体查询
    if (isTouchDevice()) {
      dpad.style.display = 'block';
      mobileActions.style.display = 'flex';
    }
  }

  function nextLevel() {
    if (currentLevelIndex < LEVELS.length - 1) {
      startLevel(currentLevelIndex + 1);
    } else {
      showMenu();
    }
  }

  function markCompleted(index) {
    completedLevels.add(index);
    try {
      localStorage.setItem('baba_completed', JSON.stringify([...completedLevels]));
    } catch (e) {}
  }

  // ==================== 游戏循环 ====================

  function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastRenderTime) / 1000, 0.1);
    lastRenderTime = timestamp;

    if (gameState === 'playing' || gameState === 'win' || gameState === 'lose') {
      renderer.render(engine.grid, engine.rules, dt);
      renderer.drawRules(renderer.ctx, engine.rules);
      renderer.drawHints(renderer.ctx);
    }

    requestAnimationFrame(gameLoop);
  }

  // ==================== 输入处理 ====================

  document.addEventListener('keydown', (e) => {
    if (gameState === 'menu') return;

    // 方向键/WASD
    let dir = null;
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': dir = DIR.UP; break;
      case 'ArrowDown': case 's': case 'S': dir = DIR.DOWN; break;
      case 'ArrowLeft': case 'a': case 'A': dir = DIR.LEFT; break;
      case 'ArrowRight': case 'd': case 'D': dir = DIR.RIGHT; break;
      case 'z': case 'Z':
        engine.undo();
        gameState = 'playing';
        hideAllOverlays();
        return;
      case 'r': case 'R':
        engine.reset();
        gameState = 'playing';
        hideAllOverlays();
        return;
      case 'Escape':
        showMenu();
        return;
    }

    if (dir && gameState === 'playing') {
      e.preventDefault();
      const result = engine.move(dir);
      if (result.moved) {
        if (engine.isWin) {
          gameState = 'win';
          markCompleted(currentLevelIndex);
          showWin();
        } else if (engine.isLose) {
          gameState = 'lose';
          showLose();
        }
      }
    }
  });

  // 触摸/滑动支持
  let touchStartX = 0, touchStartY = 0;
  canvas.addEventListener('touchstart', (e) => {
    // 如果触摸点在 dpad 或 mobileActions 区域内，不记录滑动起点
    const t = e.touches[0];
    const target = document.elementFromPoint(t.clientX, t.clientY);
    if (target && (target.closest('#dpad') || target.closest('#mobileActions'))) return;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    if (gameState !== 'playing') return;
    // 如果结束点在 dpad 或 mobileActions 区域，忽略
    const t = e.changedTouches[0];
    const target = document.elementFromPoint(t.clientX, t.clientY);
    if (target && (target.closest('#dpad') || target.closest('#mobileActions'))) return;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (Math.max(absDx, absDy) < 20) return;

    let dir;
    if (absDx > absDy) {
      dir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
    } else {
      dir = dy > 0 ? DIR.DOWN : DIR.UP;
    }
    const result = engine.move(dir);
    if (result.moved) {
      if (engine.isWin) {
        gameState = 'win';
        markCompleted(currentLevelIndex);
        showWin();
      } else if (engine.isLose) {
        gameState = 'lose';
        showLose();
      }
    }
  }, { passive: true });

  // 手机端虚拟方向键
  const dpad = document.getElementById('dpad');
  const mobileActions = document.getElementById('mobileActions');

  function dpadMove(dir) {
    if (gameState !== 'playing') return;
    const result = engine.move(dir);
    if (result.moved) {
      if (engine.isWin) {
        gameState = 'win';
        markCompleted(currentLevelIndex);
        showWin();
      } else if (engine.isLose) {
        gameState = 'lose';
        showLose();
      }
    }
  }

  // 绑定 dpad 按钮事件（touchstart 优先解决手机端延迟）
  function bindDpadBtn(id, dir) {
    const btn = document.getElementById(id);
    // touchstart：即时响应，阻止事件冒泡到 canvas
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dpadMove(dir);
    }, { passive: false });
    // click：兼容鼠标点击（桌面调试用）
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      dpadMove(dir);
    });
  }

  bindDpadBtn('dpadUp',    DIR.UP);
  bindDpadBtn('dpadDown',  DIR.DOWN);
  bindDpadBtn('dpadLeft',  DIR.LEFT);
  bindDpadBtn('dpadRight', DIR.RIGHT);

  document.getElementById('mobileUndoBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (gameState !== 'playing') return;
    engine.undo();
  }, { passive: false });
  document.getElementById('mobileUndoBtn').addEventListener('click', (e) => {
    e.preventDefault();
    if (gameState !== 'playing') return;
    engine.undo();
  });

  document.getElementById('mobileResetBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (gameState !== 'playing') return;
    engine.reset();
  }, { passive: false });
  document.getElementById('mobileResetBtn').addEventListener('click', (e) => {
    e.preventDefault();
    if (gameState !== 'playing') return;
    engine.reset();
  });

  // ==================== 弹窗 ====================

  function showWin() {
    winOverlay.style.display = 'flex';
    document.getElementById('winLevelName').textContent = `第${currentLevelIndex + 1}关 · ${LEVELS[currentLevelIndex].name}`;
    const nextBtn = document.getElementById('winNextBtn');
    if (currentLevelIndex >= LEVELS.length - 1) {
      nextBtn.style.display = 'none';
    } else {
      nextBtn.style.display = '';
    }
    dpad.style.display = 'none';
    mobileActions.style.display = 'none';
  }

  function showLose() {
    loseOverlay.style.display = 'flex';
    dpad.style.display = 'none';
    mobileActions.style.display = 'none';
  }

  // 按钮事件
  document.getElementById('winNextBtn').addEventListener('click', nextLevel);
  document.getElementById('winRetryBtn').addEventListener('click', () => {
    engine.reset();
    gameState = 'playing';
    hideAllOverlays();
    if (isTouchDevice()) {
      dpad.style.display = 'block';
      mobileActions.style.display = 'flex';
    }
  });
  document.getElementById('winMenuBtn').addEventListener('click', showMenu);
  document.getElementById('loseRetryBtn').addEventListener('click', () => {
    engine.reset();
    gameState = 'playing';
    hideAllOverlays();
    if (isTouchDevice()) {
      dpad.style.display = 'block';
      mobileActions.style.display = 'flex';
    }
  });
  document.getElementById('loseMenuBtn').addEventListener('click', showMenu);
  document.getElementById('menuBackBtn').addEventListener('click', () => {
    window.location.href = '../';
  });
  document.getElementById('inGameBackBtn').addEventListener('click', showMenu);

  // ==================== 窗口事件 ====================

  window.addEventListener('resize', () => {
    if (renderer) {
      renderer.resize();
      if (engine.grid) renderer.calcLayout(engine.grid);
    }
  });

  // ==================== 启动 ====================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
