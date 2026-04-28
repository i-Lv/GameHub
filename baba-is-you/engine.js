/**
 * Baba Is You 中文版 — 底层引擎
 * 规则解析、移动推动、胜负判定、撤销系统
 */

// ==================== 类型定义 ====================

/** 名词文字块类型 */
const NOUN_TEXTS = [
  'TEXT_BABA', 'TEXT_WALL', 'TEXT_FLAG', 'TEXT_ROCK', 'TEXT_WATER',
  'TEXT_SKULL', 'TEXT_LAVA', 'TEXT_KEY', 'TEXT_DOOR', 'TEXT_LOVE'
];

/** 属性文字块类型 */
const PROPERTY_TEXTS = [
  'TEXT_YOU', 'TEXT_WIN', 'TEXT_STOP', 'TEXT_PUSH', 'TEXT_DEFEAT',
  'TEXT_SINK', 'TEXT_HOT', 'TEXT_MELT', 'TEXT_OPEN', 'TEXT_SHUT'
];

/** 所有文字块 */
const ALL_TEXTS = [...NOUN_TEXTS, 'TEXT_IS', ...PROPERTY_TEXTS];

/** 所有实体块 */
const ALL_ENTITIES = [
  'BABA', 'WALL', 'FLAG', 'ROCK', 'WATER', 'SKULL', 'LAVA',
  'KEY', 'DOOR', 'LOVE'
];

/** 属性枚举 */
const PROP = {
  YOU: 'YOU', WIN: 'WIN', STOP: 'STOP', PUSH: 'PUSH',
  DEFEAT: 'DEFEAT', SINK: 'SINK', HOT: 'HOT', MELT: 'MELT',
  OPEN: 'OPEN', SHUT: 'SHUT'
};

// 名词文字 → 对应实体
const NOUN_TO_ENTITY = {
  TEXT_BABA: 'BABA', TEXT_WALL: 'WALL', TEXT_FLAG: 'FLAG',
  TEXT_ROCK: 'ROCK', TEXT_WATER: 'WATER', TEXT_SKULL: 'SKULL', TEXT_LAVA: 'LAVA',
  TEXT_KEY: 'KEY', TEXT_DOOR: 'DOOR', TEXT_LOVE: 'LOVE'
};

// 属性文字 → 属性名
const PROP_TEXT_TO_PROP = {
  TEXT_YOU: 'YOU', TEXT_WIN: 'WIN', TEXT_STOP: 'STOP', TEXT_PUSH: 'PUSH',
  TEXT_DEFEAT: 'DEFEAT', TEXT_SINK: 'SINK', TEXT_HOT: 'HOT', TEXT_MELT: 'MELT',
  TEXT_OPEN: 'OPEN', TEXT_SHUT: 'SHUT'
};

// 显示名映射
const DISPLAY_NAMES = {
  TEXT_BABA: '玲玲', TEXT_WALL: '墙', TEXT_FLAG: '旗', TEXT_ROCK: '石',
  TEXT_WATER: '水', TEXT_SKULL: '骷髅', TEXT_LAVA: '岩浆',
  TEXT_KEY: '钥匙', TEXT_DOOR: '门', TEXT_LOVE: '心',
  TEXT_IS: '是',
  TEXT_YOU: '你', TEXT_WIN: '赢', TEXT_STOP: '停', TEXT_PUSH: '推',
  TEXT_DEFEAT: '死', TEXT_SINK: '沉', TEXT_HOT: '热', TEXT_MELT: '化',
  TEXT_OPEN: '开', TEXT_SHUT: '关',
  BABA: '玲玲', WALL: '墙', FLAG: '旗', ROCK: '石',
  WATER: '水', SKULL: '骷髅', LAVA: '岩浆',
  KEY: '钥匙', DOOR: '门', LOVE: '心'
};

function isText(type) { return type.startsWith('TEXT_'); }
function isNounText(type) { return NOUN_TEXTS.includes(type); }
function isPropertyText(type) { return PROPERTY_TEXTS.includes(type); }
function isEntity(type) { return ALL_ENTITIES.includes(type); }
function isPushable(cell) {
  // 文字块始终可推；实体需要 PUSH 属性
  return cell.isText || cell.activeProperties.has(PROP.PUSH);
}

// ==================== 棋盘 ====================

class Grid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cells = new Map(); // "x,y" → Cell[]
    this.nextId = 0;
  }

  get(x, y) {
    return this.cells.get(`${x},${y}`) || [];
  }

  add(cell) {
    const key = `${cell.x},${cell.y}`;
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push(cell);
  }

  remove(cell) {
    const key = `${cell.x},${cell.y}`;
    const arr = this.cells.get(key);
    if (arr) {
      const idx = arr.indexOf(cell);
      if (idx >= 0) arr.splice(idx, 1);
      if (arr.length === 0) this.cells.delete(key);
    }
  }

  moveTo(cell, nx, ny) {
    this.remove(cell);
    cell.x = nx;
    cell.y = ny;
    this.add(cell);
  }

  allCells() {
    const result = [];
    for (const arr of this.cells.values()) {
      result.push(...arr);
    }
    return result;
  }

  clone() {
    const g = new Grid(this.width, this.height);
    g.nextId = this.nextId;
    for (const arr of this.cells.values()) {
      for (const c of arr) {
        const nc = { ...c, activeProperties: new Set(c.activeProperties) };
        g.add(nc);
      }
    }
    return g;
  }

  loadFrom(snapshot) {
    this.cells.clear();
    for (const c of snapshot) {
      this.add({ ...c, activeProperties: new Set(c.activeProperties) });
    }
  }
}

// ==================== 规则引擎 ====================

/**
 * 扫描棋盘，找出所有 名词+是+属性/名词 的规则
 */
function scanRules(grid) {
  const rules = [];

  // 水平扫描
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x <= grid.width - 3; x++) {
      const cells = [grid.get(x, y), grid.get(x + 1, y), grid.get(x + 2, y)];
      const rule = tryParseRule(cells);
      if (rule) rules.push(rule);
    }
  }

  // 垂直扫描
  for (let x = 0; x < grid.width; x++) {
    for (let y = 0; y <= grid.height - 3; y++) {
      const cells = [grid.get(x, y), grid.get(x, y + 1), grid.get(x, y + 2)];
      const rule = tryParseRule(cells);
      if (rule) rules.push(rule);
    }
  }

  return rules;
}

function tryParseRule(cellsAtThreePositions) {
  // 每个位置可能有多个方块，找文字块
  for (const a of cellsAtThreePositions[0]) {
    if (!isNounText(a.type)) continue;
    for (const b of cellsAtThreePositions[1]) {
      if (b.type !== 'TEXT_IS') continue;
      for (const c of cellsAtThreePositions[2]) {
        if (isPropertyText(c.type)) {
          return { subject: a.type, predicate: c.type, type: 'property' };
        }
        if (isNounText(c.type)) {
          return { subject: a.type, predicate: c.type, type: 'transform' };
        }
      }
    }
  }
  return null;
}

/**
 * 应用规则到棋盘
 */
function applyRules(rules, grid) {
  // 第一步：清空所有实体方块的属性
  for (const cell of grid.allCells()) {
    if (!cell.isText) {
      cell.activeProperties.clear();
    }
  }

  // 第二步：根据规则赋属性 / 变身
  for (const rule of rules) {
    const entityType = NOUN_TO_ENTITY[rule.subject];
    if (!entityType) continue;

    if (rule.type === 'property') {
      const propName = PROP_TEXT_TO_PROP[rule.predicate];
      if (!propName) continue;
      for (const cell of grid.allCells()) {
        if (!cell.isText && cell.type === entityType) {
          cell.activeProperties.add(propName);
        }
      }
    } else if (rule.type === 'transform') {
      const targetEntity = NOUN_TO_ENTITY[rule.predicate];
      if (!targetEntity || targetEntity === entityType) continue;
      for (const cell of grid.allCells()) {
        if (!cell.isText && cell.type === entityType) {
          cell.type = targetEntity;
        }
      }
    }
  }
}

// ==================== 移动与推动 ====================

const DIR = {
  UP: { dx: 0, dy: -1 },
  DOWN: { dx: 0, dy: 1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 }
};

/**
 * 尝试将 cell 向 direction 移动
 * Bug Fix: STOP 实体本身不可推，无论同格是否有可推方块
 * 正确逻辑：
 *   1. 检查目标格所有方块
 *   2. 若有不可推的 STOP 实体 → 直接返回 false
 *   3. 若有可推方块 → 尝试递归推动
 *   4. 递归成功后，目标格应该已清空这些可推块，可以进入
 */
function tryMove(grid, cell, direction) {
  const dx = direction.dx;
  const dy = direction.dy;
  const nx = cell.x + dx;
  const ny = cell.y + dy;

  // 边界检查
  if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) return false;

  const targets = grid.get(nx, ny);

  // Bug Fix #1: 先检查是否有无法推动的阻挡实体
  // STOP 的非文字实体且本身不可推 → 阻挡
  for (const t of targets) {
    if (t === cell) continue;
    if (!t.isText && t.activeProperties.has(PROP.STOP) && !t.activeProperties.has(PROP.PUSH)) {
      return false;
    }
  }

  // 收集需要推动的方块（文字块 + 有PUSH属性的实体）
  const pushables = targets.filter(t => t !== cell && isPushable(t));

  // Bug Fix #2: SHUT 遇到 OPEN → 互相消除（OPEN+SHUT 机制）
  // 检查 cell 是否有 OPEN，目标格是否有 SHUT（或反之）
  if (!cell.isText) {
    const hasOpen = cell.activeProperties.has(PROP.OPEN);
    const hasShut = cell.activeProperties.has(PROP.SHUT);
    const targetShut = targets.filter(t => !t.isText && t.activeProperties.has(PROP.SHUT));
    const targetOpen = targets.filter(t => !t.isText && t.activeProperties.has(PROP.OPEN));
    if (hasOpen && targetShut.length > 0) {
      // OPEN 碰 SHUT → 两者消除，通过
      grid.moveTo(cell, nx, ny);
      for (const t of targetShut) grid.remove(t);
      grid.remove(cell);
      return true; // 消除后算"通过"（cell已被移除）
    }
    if (hasShut && targetOpen.length > 0) {
      grid.moveTo(cell, nx, ny);
      for (const t of targetOpen) grid.remove(t);
      grid.remove(cell);
      return true;
    }
  }

  // 递归推动可推方块
  if (pushables.length > 0) {
    // 快照当前位置（如果推动失败需要还原）
    const snapshots = pushables.map(p => ({ cell: p, x: p.x, y: p.y }));
    let allPushed = true;
    for (const p of pushables) {
      if (!tryMove(grid, p, direction)) {
        allPushed = false;
        break;
      }
    }
    if (!allPushed) {
      // 还原被推动的方块（回滚）
      for (const s of snapshots) {
        grid.remove(s.cell);
        s.cell.x = s.x;
        s.cell.y = s.y;
        grid.add(s.cell);
      }
      return false;
    }
    // 推动成功后，再次检查目标格是否还有 STOP 阻挡
    const remaining = grid.get(nx, ny);
    for (const t of remaining) {
      if (t === cell) continue;
      if (!t.isText && t.activeProperties.has(PROP.STOP) && !t.activeProperties.has(PROP.PUSH)) {
        // 还原所有推过的方块
        for (const s of snapshots) {
          grid.remove(s.cell);
          s.cell.x = s.x;
          s.cell.y = s.y;
          grid.add(s.cell);
        }
        return false;
      }
    }
  }

  // 执行移动
  grid.moveTo(cell, nx, ny);
  return true;
}

// ==================== 胜负判定 ====================

/**
 * Bug Fix #3: SINK 消除所有进入同格的实体（不只是 YOU）
 * 这在 postMove 阶段统一处理
 */
function checkSinkHotMelt(grid) {
  const toDestroy = new Set();
  const allCells = grid.allCells();

  // 收集每个位置的方块
  const byPos = new Map();
  for (const c of allCells) {
    const key = `${c.x},${c.y}`;
    if (!byPos.has(key)) byPos.set(key, []);
    byPos.get(key).push(c);
  }

  for (const [, cells] of byPos) {
    const sinkCells = cells.filter(c => !c.isText && c.activeProperties.has(PROP.SINK));
    const hotCells  = cells.filter(c => !c.isText && c.activeProperties.has(PROP.HOT));
    const meltCells = cells.filter(c => !c.isText && c.activeProperties.has(PROP.MELT));

    // SINK: 同格任意两个实体（至少一个有SINK）→ 全部消除
    if (sinkCells.length > 0) {
      const nonTextCells = cells.filter(c => !c.isText);
      if (nonTextCells.length > 1) {
        for (const c of nonTextCells) toDestroy.add(c);
      }
    }

    // HOT + MELT: MELT 方消失
    if (hotCells.length > 0 && meltCells.length > 0) {
      for (const c of meltCells) toDestroy.add(c);
    }
  }

  let destroyed = false;
  for (const c of toDestroy) {
    grid.remove(c);
    destroyed = true;
  }
  return destroyed;
}

function checkWinLose(grid) {
  const youEntities = grid.allCells().filter(c => !c.isText && c.activeProperties.has(PROP.YOU));
  let hasWin = false;
  let hasLose = false;
  const toDestroy = new Set();

  for (const you of youEntities) {
    const sameCell = grid.get(you.x, you.y);

    for (const other of sameCell) {
      if (other === you) continue;
      if (other.isText) continue;

      // WIN 检测
      if (other.activeProperties.has(PROP.WIN)) {
        hasWin = true;
      }
      // DEFEAT 检测
      if (other.activeProperties.has(PROP.DEFEAT)) {
        toDestroy.add(you);
      }
    }
  }

  // 销毁 DEFEAT 消灭的 YOU
  for (const c of toDestroy) {
    grid.remove(c);
  }

  // 检查是否还有 YOU（无 YOU 且有过 YOU → 死亡）
  if (!hasWin) {
    const remaining = grid.allCells().filter(c => !c.isText && c.activeProperties.has(PROP.YOU));
    if (remaining.length === 0 && youEntities.length > 0) {
      hasLose = true;
    }
  }

  return { hasWin, hasLose };
}

// ==================== 游戏状态 ====================

class GameEngine {
  constructor() {
    this.grid = null;
    this.rules = [];
    this.history = [];
    this.maxHistory = 200;
    this.isWin = false;
    this.isLose = false;
    this.currentLevel = null;
  }

  loadLevel(levelData) {
    this.grid = new Grid(levelData.width, levelData.height);
    this.grid.nextId = 0;
    this.rules = [];
    this.history = [];
    this.isWin = false;
    this.isLose = false;
    this.currentLevel = levelData;

    // 加载方块
    for (const obj of levelData.objects) {
      this.grid.add({
        id: this.grid.nextId++,
        type: obj.type,
        x: obj.x,
        y: obj.y,
        isText: isText(obj.type),
        activeProperties: new Set()
      });
    }

    // 初始规则扫描
    this.rules = scanRules(this.grid);
    applyRules(this.rules, this.grid);
    // 初始 SINK/HOT-MELT 检查（防止初始布局就有重叠）
    checkSinkHotMelt(this.grid);
    this.saveHistory();
  }

  saveHistory() {
    const snapshot = this.grid.allCells().map(c => ({
      id: c.id, type: c.type, x: c.x, y: c.y, isText: c.isText,
      activeProperties: [...c.activeProperties]
    }));
    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  undo() {
    if (this.history.length <= 1) return false;
    this.history.pop();
    const prev = this.history[this.history.length - 1];
    this.grid.loadFrom(prev);
    this.rules = scanRules(this.grid);
    applyRules(this.rules, this.grid);
    this.isWin = false;
    this.isLose = false;
    return true;
  }

  reset() {
    if (this.currentLevel) {
      this.loadLevel(this.currentLevel);
    }
  }

  move(direction) {
    if (this.isWin || this.isLose) return { moved: false, rules: this.rules };

    // 找出所有 YOU 实体
    const youEntities = this.grid.allCells().filter(
      c => !c.isText && c.activeProperties.has(PROP.YOU)
    );

    if (youEntities.length === 0) return { moved: false, rules: this.rules };

    let anyMoved = false;

    // Bug Fix #4: 用快照记录所有 YOU 的初始位置，避免同一实体被多次移动
    // 同时用 Set 记录本轮已移动的实体 ID
    const movedIds = new Set();
    // 对 YOU 列表做快照，防止在迭代中 grid 状态变化影响查找
    const youSnapshot = youEntities.map(e => ({ id: e.id, ref: e }));

    for (const { id, ref } of youSnapshot) {
      if (movedIds.has(id)) continue;
      // 确认该实体仍在 grid 中（可能被前一个 YOU 的推动间接消除）
      if (!this.grid.allCells().includes(ref)) continue;
      if (tryMove(this.grid, ref, direction)) {
        anyMoved = true;
        movedIds.add(id);
      }
    }

    if (anyMoved) {
      // 重新扫描和应用规则（可能有多轮变身）
      let maxIterations = 10;
      while (maxIterations-- > 0) {
        const oldTypes = new Map(this.grid.allCells().map(c => [c.id, c.type]));
        this.rules = scanRules(this.grid);
        applyRules(this.rules, this.grid);
        let transformed = false;
        for (const c of this.grid.allCells()) {
          if (c.type !== oldTypes.get(c.id)) {
            transformed = true;
            break;
          }
        }
        if (!transformed) break;
      }

      // SINK / HOT-MELT 效果（通用，不只针对 YOU）
      const sinkDestroyed = checkSinkHotMelt(this.grid);
      if (sinkDestroyed) {
        // 状态变化后重扫规则
        this.rules = scanRules(this.grid);
        applyRules(this.rules, this.grid);
      }

      // 胜负判定
      const result = checkWinLose(this.grid);
      if (result.hasWin) this.isWin = true;
      if (result.hasLose) this.isLose = true;

      this.saveHistory();
    }

    return { moved: anyMoved, rules: this.rules };
  }
}

// 导出
window.GameEngine = GameEngine;
window.Grid = Grid;
window.isText = isText;
window.DISPLAY_NAMES = DISPLAY_NAMES;
window.PROP = PROP;
window.DIR = DIR;
window.NOUN_TEXTS = NOUN_TEXTS;
