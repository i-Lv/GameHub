/**
 * Baba Is You 中文版 — 关卡数据（重设计版）
 *
 * 关卡设计哲学：
 *   每一关只教一件事，让玩家在"啊哈！"中理解规则的本质
 *   难度曲线：感知规则 → 打破规则 → 利用规则 → 组合规则 → 反转规则 → 终极创造
 *
 * 编码规范：
 *   文字块用 TEXT_XXX，实体用 XXX
 *   规则三元组：名词(x,y) 是(x+1,y) 属性(x+2,y) — 或垂直排列
 *   注意：文字不能贴边（贴边无法被推散）
 *         每关初始状态不能自动胜利
 *         玩家需要至少思考两步
 */

const LEVELS = [

  // ─────────────────────────────────────────────
  // 第1关：认识规则
  // 教学目标：理解"规则方块"的存在——走向旗即可胜利
  // 解法：向右走到旗帜
  // 亮点：旗和规则都清晰可见，走过去就赢
  // ─────────────────────────────────────────────
  {
    name: '认识规则', nameEn: 'Learn the Rules', hint: '找到旗帜，走过去',
    width: 11, height: 7,
    objects: [
      // 规则：玲玲 是 你
      { type: 'TEXT_BABA', x: 1, y: 1 }, { type: 'TEXT_IS', x: 2, y: 1 }, { type: 'TEXT_YOU', x: 3, y: 1 },
      // 规则：旗 是 赢
      { type: 'TEXT_FLAG', x: 7, y: 1 }, { type: 'TEXT_IS', x: 8, y: 1 }, { type: 'TEXT_WIN', x: 9, y: 1 },
      // 实体
      { type: 'BABA', x: 2, y: 4 },
      { type: 'FLAG', x: 8, y: 4 },
    ]
  },

  // ─────────────────────────────────────────────
  // 第2关：推开障碍
  // 教学目标：理解 PUSH —— 推开石头开路
  // 解法：向右推石头，然后绕路走到旗
  // 亮点：墙无法推，石头可推——两种阻挡的对比
  // ─────────────────────────────────────────────
  {
    name: '推开障碍', nameEn: 'Push It', hint: '石头可以推动，墙不行',
    width: 11, height: 7,
    objects: [
      // 规则区（顶部）
      { type: 'TEXT_BABA', x: 1, y: 1 }, { type: 'TEXT_IS', x: 2, y: 1 }, { type: 'TEXT_YOU', x: 3, y: 1 },
      { type: 'TEXT_FLAG', x: 5, y: 1 }, { type: 'TEXT_IS', x: 6, y: 1 }, { type: 'TEXT_WIN', x: 7, y: 1 },
      { type: 'TEXT_ROCK', x: 1, y: 5 }, { type: 'TEXT_IS', x: 2, y: 5 }, { type: 'TEXT_PUSH', x: 3, y: 5 },
      { type: 'TEXT_WALL', x: 7, y: 5 }, { type: 'TEXT_IS', x: 8, y: 5 }, { type: 'TEXT_STOP', x: 9, y: 5 },
      // 场景：一排墙中间开了口，用石头堵上了
      { type: 'WALL', x: 5, y: 2 }, { type: 'WALL', x: 5, y: 3 },
      { type: 'ROCK', x: 5, y: 4 },
      { type: 'WALL', x: 5, y: 5 }, { type: 'WALL', x: 5, y: 6 },
      // 玩家和旗
      { type: 'BABA', x: 2, y: 4 },
      { type: 'FLAG', x: 8, y: 4 },
    ]
  },

  // ─────────────────────────────────────────────
  // 第3关：打破规则
  // 教学目标：理解可以推动文字方块，打破"墙是停"规则穿墙而过
  // 解法：把 TEXT_STOP 推开，墙不再是停止，走过墙到旗
  // 亮点：第一次体验"打破规则"的震撼
  // ─────────────────────────────────────────────
  {
    name: '打破规则', nameEn: 'Break It', hint: '"墙是停"——但规则可以被改变',
    width: 11, height: 7,
    objects: [
      // 固定规则（远离玩家，无法推散）
      { type: 'TEXT_BABA', x: 1, y: 1 }, { type: 'TEXT_IS', x: 2, y: 1 }, { type: 'TEXT_YOU', x: 3, y: 1 },
      { type: 'TEXT_FLAG', x: 7, y: 1 }, { type: 'TEXT_IS', x: 8, y: 1 }, { type: 'TEXT_WIN', x: 9, y: 1 },
      // 可破坏的规则：墙 是 停（TEXT_STOP 可被推走）
      { type: 'TEXT_WALL', x: 1, y: 3 }, { type: 'TEXT_IS', x: 2, y: 3 }, { type: 'TEXT_STOP', x: 3, y: 3 },
      // 一排墙，阻挡路径
      { type: 'WALL', x: 5, y: 1 }, { type: 'WALL', x: 5, y: 2 }, { type: 'WALL', x: 5, y: 3 },
      { type: 'WALL', x: 5, y: 4 }, { type: 'WALL', x: 5, y: 5 },
      // 旗在墙后
      { type: 'BABA', x: 2, y: 4 },
      { type: 'FLAG', x: 8, y: 4 },
    ]
  },

  // ─────────────────────────────────────────────
  // 第4关：你就是胜利
  // 教学目标：主动创造新规则 — 把文字块推成完整规则
  // 解法：把 TEXT_WIN 向上推到 TEXT_IS 下方，
  //       凑成垂直规则 TEXT_BABA(x=3,y=3) / TEXT_IS(x=3,y=4) / TEXT_WIN(x=3,y=5)
  //       = "玲玲 是 赢"，玲玲本身就是胜利，立即过关
  // 亮点：旗在封闭区域不可达，引导玩家发现"创造规则"的乐趣
  // ─────────────────────────────────────────────
  {
    name: '你就是胜利', nameEn: 'You Win', hint: '旗在墙后……也许不需要旗',
    width: 11, height: 9,
    objects: [
      // 固定规则：玲玲 是 你（水平）
      { type: 'TEXT_BABA', x: 1, y: 1 }, { type: 'TEXT_IS', x: 2, y: 1 }, { type: 'TEXT_YOU', x: 3, y: 1 },
      // 旗 是 赢（上方，旗不可达，迷惑规则）
      { type: 'TEXT_FLAG', x: 7, y: 1 }, { type: 'TEXT_IS', x: 8, y: 1 }, { type: 'TEXT_WIN', x: 9, y: 1 },
      // 待组合的垂直规则：
      //   TEXT_BABA (3,3) — 固定在顶部，推不到边界
      //   TEXT_IS   (3,4) — 中间
      //   TEXT_WIN 需要玩家从 (3,7) 往上推到 (3,5)
      { type: 'TEXT_BABA', x: 3, y: 3 },
      { type: 'TEXT_IS',   x: 3, y: 4 },
      { type: 'TEXT_WIN',  x: 3, y: 7 },
      // 厚墙封锁旗帜
      { type: 'WALL', x: 6, y: 3 }, { type: 'WALL', x: 7, y: 3 }, { type: 'WALL', x: 8, y: 3 },
      { type: 'WALL', x: 9, y: 3 }, { type: 'WALL', x: 10, y: 3 },
      { type: 'WALL', x: 6, y: 4 }, { type: 'WALL', x: 10, y: 4 },
      { type: 'WALL', x: 6, y: 5 }, { type: 'WALL', x: 10, y: 5 },
      { type: 'WALL', x: 6, y: 6 }, { type: 'WALL', x: 10, y: 6 },
      { type: 'WALL', x: 6, y: 7 }, { type: 'WALL', x: 7, y: 7 },
      { type: 'WALL', x: 8, y: 7 }, { type: 'WALL', x: 9, y: 7 }, { type: 'WALL', x: 10, y: 7 },
      // 旗在封闭区域内
      { type: 'FLAG', x: 8, y: 5 },
      // 玩家
      { type: 'BABA', x: 1, y: 6 },
    ]
  },

  // ─────────────────────────────────────────────
  // 第5关：沉石开路
  // 教学目标：理解 SINK —— 石头沉入水中，两者同时消失，开出通路
  // 解法：把石头推入水中（石头+水同时消失），再走过去
  // 亮点：SINK 是双向消除，用牺牲来换通路
  // ─────────────────────────────────────────────
  {
    name: '沉石开路', nameEn: 'Sink the Rock', hint: '石头和水相遇会发生什么？',
    width: 11, height: 7,
    objects: [
      // 规则区
      { type: 'TEXT_BABA', x: 1, y: 1 }, { type: 'TEXT_IS', x: 2, y: 1 }, { type: 'TEXT_YOU', x: 3, y: 1 },
      { type: 'TEXT_FLAG', x: 5, y: 1 }, { type: 'TEXT_IS', x: 6, y: 1 }, { type: 'TEXT_WIN', x: 7, y: 1 },
      { type: 'TEXT_WATER', x: 1, y: 5 }, { type: 'TEXT_IS', x: 2, y: 5 }, { type: 'TEXT_SINK', x: 3, y: 5 },
      { type: 'TEXT_ROCK',  x: 7, y: 5 }, { type: 'TEXT_IS', x: 8, y: 5 }, { type: 'TEXT_PUSH', x: 9, y: 5 },
      // 场景：水挡路，石头在左侧，旗在右侧
      { type: 'WATER', x: 5, y: 3 }, { type: 'WATER', x: 5, y: 4 }, { type: 'WATER', x: 5, y: 5 },
      { type: 'ROCK',  x: 3, y: 3 },
      { type: 'BABA',  x: 1, y: 3 },
      { type: 'FLAG',  x: 9, y: 3 },
    ]
  },

  // ─────────────────────────────────────────────
  // 第6关：危险的骷髅
  // 教学目标：理解 DEFEAT，以及打破 DEFEAT 规则的方法
  // 解法：把 TEXT_DEFEAT 从规则链中推走，骷髅变无害，直接走过去
  // 亮点：骷髅看起来很危险，但规则说了算
  // ─────────────────────────────────────────────
  {
    name: '规则说了算', nameEn: 'Rules Rule', hint: '骷髅危险吗？这取决于规则',
    width: 11, height: 7,
    objects: [
      // 固定规则
      { type: 'TEXT_BABA', x: 1, y: 1 }, { type: 'TEXT_IS', x: 2, y: 1 }, { type: 'TEXT_YOU', x: 3, y: 1 },
      { type: 'TEXT_FLAG', x: 5, y: 1 }, { type: 'TEXT_IS', x: 6, y: 1 }, { type: 'TEXT_WIN', x: 7, y: 1 },
      // 骷髅是死（TEXT_DEFEAT 可被推走）
      { type: 'TEXT_SKULL', x: 2, y: 3 }, { type: 'TEXT_IS', x: 3, y: 3 }, { type: 'TEXT_DEFEAT', x: 4, y: 3 },
      // 骷髅阵列挡路
      { type: 'SKULL', x: 6, y: 2 }, { type: 'SKULL', x: 6, y: 3 }, { type: 'SKULL', x: 6, y: 4 },
      { type: 'SKULL', x: 7, y: 2 }, { type: 'SKULL', x: 7, y: 3 }, { type: 'SKULL', x: 7, y: 4 },
      // 旗在骷髅后
      { type: 'BABA', x: 1, y: 3 },
      { type: 'FLAG', x: 9, y: 3 },
    ]
  },

  // ─────────────────────────────────────────────
  // 第7关：水火不容
  // 教学目标：理解 HOT + MELT 互动，以及如何利用它消除障碍
  // 解法：把"玲玲 是 化"推散，让自己不再 MELT，然后走过岩浆到旗
  //       或者：把岩浆推走（岩浆 是 推），接触后互相触发
  // 亮点：HOT+MELT 是环境危险，但规则可以解除
  // ─────────────────────────────────────────────
  {
    name: '水火不容', nameEn: 'Fire and Ice', hint: '岩浆很烫——但也许你可以不怕烫',
    width: 11, height: 9,
    objects: [
      // 固定规则
      { type: 'TEXT_BABA', x: 1, y: 1 }, { type: 'TEXT_IS', x: 2, y: 1 }, { type: 'TEXT_YOU', x: 3, y: 1 },
      { type: 'TEXT_FLAG', x: 7, y: 1 }, { type: 'TEXT_IS', x: 8, y: 1 }, { type: 'TEXT_WIN', x: 9, y: 1 },
      // 岩浆是热（固定在角落，无法推散）
      { type: 'TEXT_LAVA', x: 1, y: 7 }, { type: 'TEXT_IS', x: 2, y: 7 }, { type: 'TEXT_HOT', x: 3, y: 7 },
      // 玲玲是化（可以推走 TEXT_MELT）
      { type: 'TEXT_BABA', x: 7, y: 7 }, { type: 'TEXT_IS', x: 8, y: 7 }, { type: 'TEXT_MELT', x: 9, y: 7 },
      // 岩浆通道（横贯中间）
      { type: 'LAVA', x: 3, y: 4 }, { type: 'LAVA', x: 4, y: 4 }, { type: 'LAVA', x: 5, y: 4 },
      { type: 'LAVA', x: 6, y: 4 }, { type: 'LAVA', x: 7, y: 4 }, { type: 'LAVA', x: 8, y: 4 },
      // 玩家和旗
      { type: 'BABA', x: 2, y: 3 },
      { type: 'FLAG', x: 8, y: 6 },
    ]
  },

  // ─────────────────────────────────────────────
  // 第8关：拼合规则
  // 教学目标：主动组合散落的文字块来创造胜利规则
  // 解法：
  //   玩家走到 (9,8) 向上推 TEXT_WIN(9,7)
  //   TEXT_WIN 依次到 (9,6)→(9,5)→(9,4)
  //   完成规则 "旗(7,4) 是(8,4) 赢(9,4)"
  //   然后绕到墙右侧走向 FLAG(11,6)
  // ─────────────────────────────────────────────
  {
    name: '拼合规则', nameEn: 'Build the Rule', hint: '"旗 是 ___"，缺的那块字在哪里？',
    width: 13, height: 9,
    objects: [
      // 固定规则
      { type: 'TEXT_BABA', x: 1, y: 1 }, { type: 'TEXT_IS', x: 2, y: 1 }, { type: 'TEXT_YOU', x: 3, y: 1 },
      // 不完整规则："旗(7,4) 是(8,4)"（水平，缺 WIN）
      { type: 'TEXT_FLAG', x: 7, y: 4 }, { type: 'TEXT_IS', x: 8, y: 4 },
      // TEXT_WIN 在正下方 (9,7)，需要从下往上推到 (9,4)
      { type: 'TEXT_WIN', x: 9, y: 7 },
      // 竖向短墙：把地图分两侧，但下方留有通道（y>=6 无墙）
      { type: 'WALL', x: 10, y: 1 }, { type: 'WALL', x: 10, y: 2 }, { type: 'WALL', x: 10, y: 3 },
      { type: 'WALL', x: 10, y: 4 }, { type: 'WALL', x: 10, y: 5 },
      // 旗帜在墙右侧，玩家需要绕下方通道(y>=6)到达
      { type: 'FLAG', x: 11, y: 6 },
      // 玩家
      { type: 'BABA', x: 2, y: 6 },
    ]
  },

  // ─────────────────────────────────────────────
  // 第9关：变身逃脱
  // 教学目标：利用"名词 是 名词"变身规则
  // 布局说明：
  //   旗在封闭区域，无法直接到达
  //   地图中有散落的 TEXT_FLAG + TEXT_IS（垂直排列 x=5）
  //   玩家需要把 TEXT_BABA(1,7) 向右推，经过通道推到 (5,7)
  //   使垂直规则 TEXT_BABA(5,5) / TEXT_IS(5,6) / [但TEXT_BABA在5,7]?
  //   
  //   正确设计：TEXT_IS(5,3) + TEXT_FLAG(5,4) 垂直，
  //   TEXT_BABA 需要推到 (5,2) → 形成 (5,2)(5,3)(5,4) = "玲玲 是 旗"
  //   玲玲变成旗，旗帜有 WIN 属性，立即胜利
  // ─────────────────────────────────────────────
  {
    name: '变身逃脱', nameEn: 'Transform', hint: '你未必永远是玲玲',
    width: 11, height: 9,
    objects: [
      // 固定规则：玲玲 是 你（水平顶部）
      { type: 'TEXT_BABA', x: 1, y: 1 }, { type: 'TEXT_IS', x: 2, y: 1 }, { type: 'TEXT_YOU', x: 3, y: 1 },
      // 固定规则：旗 是 赢（水平顶部）
      { type: 'TEXT_FLAG', x: 7, y: 1 }, { type: 'TEXT_IS', x: 8, y: 1 }, { type: 'TEXT_WIN', x: 9, y: 1 },
      // 待组合的垂直变身规则（已有 TEXT_IS + TEXT_FLAG 两块）：
      //   TEXT_IS  (5,3)
      //   TEXT_FLAG(5,4)
      //   → 需要 TEXT_BABA 推到 (5,2) 完成 (5,2)(5,3)(5,4) = "玲玲是旗"
      { type: 'TEXT_IS',   x: 5, y: 3 },
      { type: 'TEXT_FLAG', x: 5, y: 4 },
      // 供推动的 TEXT_BABA 在 (1,2)，需要向右推到 (5,2)
      // 路径：(1,2)→(2,2)→(3,2)→(4,2)→(5,2)，全程畅通
      { type: 'TEXT_BABA', x: 1, y: 2 },
      // 旗帜在封闭区域，不可直接到达
      { type: 'WALL', x: 7, y: 3 }, { type: 'WALL', x: 8, y: 3 }, { type: 'WALL', x: 9, y: 3 },
      { type: 'WALL', x: 7, y: 4 }, { type: 'WALL', x: 9, y: 4 },
      { type: 'WALL', x: 7, y: 5 }, { type: 'WALL', x: 9, y: 5 },
      { type: 'WALL', x: 7, y: 6 }, { type: 'WALL', x: 8, y: 6 }, { type: 'WALL', x: 9, y: 6 },
      { type: 'FLAG', x: 8, y: 5 },
      // 玩家初始在左侧
      { type: 'BABA', x: 2, y: 6 },
    ]
  },

  // ─────────────────────────────────────────────
  // 第10关：终章——万物皆规则
  // 教学目标：综合运用所有机制
  // 解法（三步）：
  //   ① 推走 TEXT_DEFEAT(3,3)，解除骷髅 DEFEAT 属性，骷髅变无害
  //   ② 穿过骷髅，把石头推入水中（ROCK + WATER → 两者消失）
  //      ROCK(6,5) 向右推 → (7,5)(8,5)(9,5) 碰 WATER(9,5) 消除
  //   ③ 把 TEXT_WIN 向上推到 "玲玲 是" 旁边，
  //      凑成垂直规则 TEXT_BABA(10,2) / TEXT_IS(10,3) / TEXT_WIN(10,4) = "玲玲 是 赢"
  //      立即胜利
  // 亮点：三个步骤缺一不可，顺序有逻辑，综合考验
  // ─────────────────────────────────────────────
  {
    name: '万物皆规则', nameEn: 'All is Rules', hint: '三步走，每步都用不同的知识',
    width: 13, height: 9,
    objects: [
      // 固定规则（水平，顶部）
      { type: 'TEXT_BABA',  x: 1, y: 1 }, { type: 'TEXT_IS', x: 2, y: 1 }, { type: 'TEXT_YOU',  x: 3, y: 1 },
      { type: 'TEXT_ROCK',  x: 5, y: 1 }, { type: 'TEXT_IS', x: 6, y: 1 }, { type: 'TEXT_PUSH', x: 7, y: 1 },
      { type: 'TEXT_WATER', x: 9, y: 1 }, { type: 'TEXT_IS', x: 10, y: 1 }, { type: 'TEXT_SINK', x: 11, y: 1 },

      // 可打破的规则：骷髅 是 死（TEXT_DEFEAT 可被推走，推向左边界外）
      // TEXT_SKULL(1,3) TEXT_IS(2,3) TEXT_DEFEAT(3,3) — 玩家在(4,3)向左推TEXT_DEFEAT
      { type: 'TEXT_SKULL',  x: 1, y: 3 }, { type: 'TEXT_IS', x: 2, y: 3 }, { type: 'TEXT_DEFEAT', x: 3, y: 3 },

      // 可组合的垂直规则（已有上两格）：
      //   TEXT_BABA(10,2) 固定
      //   TEXT_IS  (10,3) 固定
      //   TEXT_WIN (10,6) — 需要向上推到(10,4)
      { type: 'TEXT_BABA', x: 10, y: 2 }, { type: 'TEXT_IS', x: 10, y: 3 },
      { type: 'TEXT_WIN',  x: 10, y: 6 },

      // 障碍：骷髅在中间一排（挡住去右侧通路，推散DEFEAT后无害）
      { type: 'SKULL', x: 5, y: 4 }, { type: 'SKULL', x: 6, y: 4 }, { type: 'SKULL', x: 7, y: 4 },

      // 水障碍在右上方
      { type: 'WATER', x: 9, y: 5 }, { type: 'WATER', x: 10, y: 5 },

      // 石头在骷髅左侧，解除DEFEAT后可推穿骷髅行，推入水中消除
      { type: 'ROCK', x: 6, y: 5 },

      // 旗帜在水后方（消除水后可达，但实际胜利是靠玲玲是赢）
      { type: 'FLAG', x: 11, y: 5 },

      // 玩家起始
      { type: 'BABA', x: 1, y: 5 },
    ]
  },

];

window.LEVELS = LEVELS;
