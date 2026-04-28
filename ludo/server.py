"""
飞行棋联机对战 WebSocket 服务端
=====================================================
功能：
  - 房间管理：2-4人，不足4人AI补位
  - 颜色分配：红/蓝/绿/黄，按加入顺序
  - AI补位：房间创建时由 max_players 决定AI数量
  - 回合控制：四色轮流，AI自动行动
  - 骰子：服务端摇骰保证公平
  - 完整规则：起飞/击退/安全格/彩虹道/终点判定

消息协议（JSON）：
  客户端 → 服务端:
    { "type": "create",  "room": "xxx", "name": "昵称", "max_players": 2|3|4 }
    { "type": "join",    "room": "xxx", "name": "昵称" }
    { "type": "start_game" }
    { "type": "roll_dice" }
    { "type": "move_piece", "piece_idx": 0-3 }

  服务端 → 客户端:
    { "type": "waiting" }
    { "type": "lobby",   "room": "xxx", "max_players": 4,
                         "my_color": "red",
                         "players": [{"color":"red","name":"玩家1","type":"human"},
                                     {"color":"blue","name":"AI-蓝","type":"ai"}, ...] }
    { "type": "start",   "my_color": "red",
                         "player_types": [{"color":"red","type":"human"}, ...],
                         "player_names": {"red":"玩家1","blue":"AI-蓝",...} }
    { "type": "turn",    "color": "red" }
    { "type": "dice",    "color": "red", "value": 3, "movable": [0,2] }
    { "type": "move",    "color": "red", "piece_idx": 0,
                         "pos": 3, "rainbow": 0,
                         "kicked": [{"color":"blue","piece_idx":1}],
                         "finished": false }
    { "type": "over",    "winner": "red" }
    { "type": "error",   "msg": "..." }
    { "type": "opponent_left" }
=====================================================
"""

import asyncio
import json
import logging
import random
import time
import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

HOST = "0.0.0.0"
PORT = 6795

# ─── 飞行棋规则常量 ─────────────────────────────────────────

COLORS = ['red', 'blue', 'green', 'yellow']
COLOR_NAMES = {'red':'红色', 'blue':'蓝色', 'green':'绿色', 'yellow':'黄色'}

# 大圈路径52格，各颜色起飞格索引
START_IDX = {'red':0, 'blue':13, 'green':26, 'yellow':39}
# 各颜色进入彩虹道前最后大圈格
ENTRY_BEFORE = {'red':51, 'blue':12, 'green':25, 'yellow':38}
# 安全格
SAFE_SET = {0, 8, 13, 21, 26, 34, 39, 47}
RAINBOW_LEN = 6


# ─── 规则引擎 ──────────────────────────────────────────────

def move_piece(color, pos, rainbow, steps):
    """
    计算移动结果。
    返回 (new_pos, new_rainbow, events) 或 None（不可移动）
    events: 'launch', 'finish', 'moved'
    """
    events = []
    entry_at = ENTRY_BEFORE[color]
    n = 52

    if pos == -1:
        if steps != 6:
            return None
        return (START_IDX[color], 0, ['launch'])

    if rainbow > 0:
        new_r = rainbow + steps
        if new_r > RAINBOW_LEN:
            return None
        if new_r == RAINBOW_LEN:
            return (pos, RAINBOW_LEN, ['finish'])
        return (pos, new_r, events)

    cur_pos = pos
    for s in range(steps):
        if cur_pos == entry_at:
            rainbow = 1
            remaining = steps - s - 1
            new_r = rainbow + remaining
            if new_r > RAINBOW_LEN:
                return None
            if new_r == RAINBOW_LEN:
                events.append('finish')
            return (cur_pos, new_r, events)
        cur_pos = (cur_pos + 1) % n

    events.append('moved')
    return (cur_pos, 0, events)


def get_movable_pieces(pieces, color, dice):
    """返回可移动的棋子索引列表"""
    movable = []
    for i, p in enumerate(pieces[color]):
        if p['rainbow'] >= RAINBOW_LEN:
            continue
        if p['pos'] == -1:
            if dice == 6:
                movable.append(i)
            continue
        result = move_piece(color, p['pos'], p['rainbow'], dice)
        if result is not None:
            movable.append(i)
    return movable


def ai_choose_piece(pieces, color, dice, all_colors):
    """AI选择最佳棋子移动"""
    movable = get_movable_pieces(pieces, color, dice)
    if not movable:
        return None

    best = movable[0]
    best_score = -9999

    for idx in movable:
        p = pieces[color][idx]
        result = move_piece(color, p['pos'], p['rainbow'], dice)
        if not result:
            continue
        new_pos, new_rainbow, events = result
        score = 0

        if 'finish' in events:
            score += 1000
        if p['rainbow'] > 0:
            score += 200 + p['rainbow'] * 10
        if 'launch' in events:
            score += 100

        # 击退对方
        if new_rainbow == 0 and new_pos not in SAFE_SET:
            for c in all_colors:
                if c == color:
                    continue
                for op in pieces[c]:
                    if op['pos'] == new_pos and op['rainbow'] == 0:
                        score += 300

        # 前进距离
        if p['rainbow'] > 0:
            score += new_rainbow
        elif p['pos'] >= 0:
            start = START_IDX[color]
            d = new_pos - start
            if d < 0:
                d += 52
            score += d

        if score > best_score:
            best_score = score
            best = idx

    return best


# ─── 房间管理 ──────────────────────────────────────────────

class Room:
    def __init__(self, room_id, max_players=4):
        self.room_id = room_id
        self.max_players = max_players  # 2, 3, or 4
        self.owner = None  # 创建者ws
        self.ws_map = {}   # color -> ws (人类玩家)
        self.names = {}    # color -> name
        self.types = {}    # color -> 'human'|'ai'
        self.pieces = {}   # color -> [{'pos':-1,'rainbow':0}, ...]
        self.current_color_idx = 0  # 当前回合的颜色索引
        self.dice = 0
        self.rolled = False
        self.movable = []
        self.finished = []
        self.winner = None
        self.started = False
        self.active_colors = []  # 参与的颜色列表

    def get_active_colors(self):
        return self.active_colors

    def current_color(self):
        if not self.active_colors:
            return None
        return self.active_colors[self.current_color_idx % len(self.active_colors)]

    def next_turn(self):
        """切换到下一个未完成的颜色"""
        for _ in range(len(self.active_colors)):
            self.current_color_idx = (self.current_color_idx + 1) % len(self.active_colors)
            c = self.current_color()
            if c not in self.finished:
                return c
        return None

    def init_pieces(self):
        for c in self.active_colors:
            self.pieces[c] = [{'pos': -1, 'rainbow': 0} for _ in range(4)]

    def get_player_list(self, my_color=None):
        """返回玩家列表（含AI）"""
        result = []
        for c in self.active_colors:
            result.append({
                'color': c,
                'name': self.names.get(c, '未知'),
                'type': self.types.get(c, 'ai'),
            })
        return result

    def get_player_types(self):
        return [{'color': c, 'type': self.types.get(c, 'ai')} for c in self.active_colors]

    def is_human(self, color):
        return self.types.get(color) == 'human' and color in self.ws_map


rooms = {}


async def send_ws(ws, msg):
    try:
        await ws.send(json.dumps(msg))
    except Exception:
        pass


async def broadcast_room(room, msg):
    for ws in room.ws_map.values():
        await send_ws(ws, msg)


async def send_lobby(room):
    """向房间内所有人类玩家发送大厅状态"""
    players = room.get_player_list()
    for color, ws in room.ws_map.items():
        await send_ws(ws, {
            'type': 'lobby',
            'room': room.room_id,
            'max_players': room.max_players,
            'my_color': color,
            'players': players,
        })


# ─── 游戏逻辑 ──────────────────────────────────────────────

async def do_game_start(room):
    """游戏开始"""
    room.started = True
    room.init_pieces()
    room.current_color_idx = 0
    room.finished = []
    room.winner = None

    # 发送start消息
    for color, ws in room.ws_map.items():
        await send_ws(ws, {
            'type': 'start',
            'my_color': color,
            'player_types': room.get_player_types(),
            'player_names': {c: room.names.get(c, '') for c in room.active_colors},
        })

    # 开始第一个回合
    first_color = room.current_color()
    await broadcast_room(room, {'type': 'turn', 'color': first_color})

    # 如果第一个是AI
    if not room.is_human(first_color):
        asyncio.create_task(ai_delayed_turn(room))


async def ai_delayed_turn(room):
    """延迟后AI行动"""
    await asyncio.sleep(1.0)
    if not room.started or room.winner:
        return
    color = room.current_color()
    if room.is_human(color):
        return
    await do_ai_turn(room, color)


async def do_roll_dice(room, color):
    """摇骰子"""
    if room.rolled:
        return
    room.dice = random.randint(1, 6)
    room.rolled = True
    room.movable = get_movable_pieces(room.pieces, color, room.dice)

    await broadcast_room(room, {
        'type': 'dice',
        'color': color,
        'value': room.dice,
        'movable': room.movable,
    })

    if not room.movable:
        # 无可动棋子
        if room.dice == 6:
            # 掷6但无可动，再投
            await asyncio.sleep(0.8)
            room.rolled = False
            if not room.is_human(color):
                await do_roll_dice(room, color)
        else:
            # 换人
            await asyncio.sleep(0.8)
            await advance_turn(room)


async def do_move_piece(room, color, piece_idx):
    """移动棋子"""
    if not room.rolled or piece_idx not in room.movable:
        return

    piece = room.pieces[color][piece_idx]
    result = move_piece(color, piece['pos'], piece['rainbow'], room.dice)
    if not result:
        return

    new_pos, new_rainbow, events = result
    piece['pos'] = new_pos
    piece['rainbow'] = new_rainbow

    kicked = []
    is_finish = 'finish' in events

    # 击退检查
    if new_rainbow == 0 and new_pos >= 0 and new_pos not in SAFE_SET:
        for c in room.active_colors:
            if c == color:
                continue
            for i, op in enumerate(room.pieces[c]):
                if op['pos'] == new_pos and op['rainbow'] == 0:
                    op['pos'] = -1
                    op['rainbow'] = 0
                    kicked.append({'color': c, 'piece_idx': i})

    await broadcast_room(room, {
        'type': 'move',
        'color': color,
        'piece_idx': piece_idx,
        'pos': new_pos,
        'rainbow': new_rainbow,
        'kicked': kicked,
        'finished': is_finish,
    })

    room.rolled = False
    room.movable = []

    # 检查胜利
    if is_finish or all(p['rainbow'] >= RAINBOW_LEN for p in room.pieces[color]):
        all_done = all(p['rainbow'] >= RAINBOW_LEN for p in room.pieces[color])
        if all_done and color not in room.finished:
            room.finished.append(color)
            room.winner = color
            await broadcast_room(room, {'type': 'over', 'winner': color})
            return

    # 掷6额外回合
    if room.dice == 6:
        await asyncio.sleep(0.5)
        if not room.is_human(color):
            await do_roll_dice(room, color)
        else:
            await broadcast_room(room, {'type': 'turn', 'color': color})
    else:
        await advance_turn(room)


async def do_ai_turn(room, color):
    """AI完整回合：摇骰 → 选棋 → 移动"""
    await do_roll_dice(room, color)
    if room.movable:
        await asyncio.sleep(0.6)
        if room.winner:
            return
        choice = ai_choose_piece(
            room.pieces, color, room.dice, room.active_colors
        )
        if choice is not None:
            await do_move_piece(room, color, choice)


async def advance_turn(room):
    """切换回合"""
    if room.winner:
        return
    next_c = room.next_turn()
    if next_c is None:
        return
    await broadcast_room(room, {'type': 'turn', 'color': next_c})
    if not room.is_human(next_c):
        asyncio.create_task(ai_delayed_turn(room))


# ─── WebSocket 处理 ────────────────────────────────────────

async def handler(websocket):
    room = None
    my_color = None

    try:
        while True:
            try:
                raw = await websocket.recv()
            except websockets.exceptions.ConnectionClosed:
                break

            try:
                msg = json.loads(raw)
            except ValueError:
                await send_ws(websocket, {'type': 'error', 'msg': '无效消息'})
                continue

            mtype = msg.get('type')

            # ── 创建房间 ─────────────────────────────
            if mtype == 'create':
                rid = str(msg.get('room', '')).strip()
                if not rid:
                    rid = ''.join(random.choices('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', k=6))
                player_name = str(msg.get('name', '')).strip()[:12] or ('玩家' + str(random.randint(100, 999)))
                max_p = int(msg.get('max_players', 4))
                max_p = max(2, min(4, max_p))

                if rid in rooms:
                    await send_ws(websocket, {'type': 'error', 'msg': '房间号已存在，请换一个'})
                    continue

                room = Room(rid, max_p)
                room.owner = websocket
                rooms[rid] = room

                # 创建者分配红色
                my_color = 'red'
                room.active_colors.append('red')
                room.ws_map['red'] = websocket
                room.names['red'] = player_name
                room.types['red'] = 'human'

                # 填充AI
                ai_colors = [c for c in COLORS if c != 'red'][:max_p - 1]
                for c in ai_colors:
                    room.active_colors.append(c)
                    room.names[c] = f'AI-{COLOR_NAMES[c]}'
                    room.types[c] = 'ai'

                log.info("[%s] 房间创建 by '%s', %d人 (含%d个AI)",
                         rid, player_name, max_p, len(ai_colors))

                await send_lobby(room)

            # ── 加入房间 ─────────────────────────────
            elif mtype == 'join':
                rid = str(msg.get('room', '')).strip()
                player_name = str(msg.get('name', '')).strip()[:12] or ('玩家' + str(random.randint(100, 999)))

                if rid not in rooms:
                    await send_ws(websocket, {'type': 'error', 'msg': '房间不存在'})
                    continue

                room = rooms[rid]

                if room.started:
                    await send_ws(websocket, {'type': 'error', 'msg': '游戏已开始'})
                    room = None
                    continue

                # 找到第一个未被人类占用的颜色
                available = [c for c in room.active_colors if room.types[c] == 'ai']
                if not available:
                    await send_ws(websocket, {'type': 'error', 'msg': '房间已满'})
                    room = None
                    continue

                my_color = available[0]
                room.ws_map[my_color] = websocket
                room.names[my_color] = player_name
                room.types[my_color] = 'human'

                log.info("[%s] '%s' 加入为 %s (%d/%d人类)",
                         rid, player_name, COLOR_NAMES[my_color],
                         sum(1 for t in room.types.values() if t == 'human'),
                         room.max_players)

                await send_lobby(room)

                # 如果人已满，自动开始
                human_count = sum(1 for t in room.types.values() if t == 'human')
                if human_count >= room.max_players:
                    await asyncio.sleep(0.5)
                    await do_game_start(room)

            # ── 房主手动开始 ─────────────────────────
            elif mtype == 'start_game':
                if room is None or room.started:
                    continue
                if websocket != room.owner:
                    await send_ws(websocket, {'type': 'error', 'msg': '只有房主可以开始'})
                    continue
                await do_game_start(room)

            # ── 摇骰子 ──────────────────────────────
            elif mtype == 'roll_dice':
                if room is None or not room.started or room.winner:
                    continue
                color = room.current_color()
                if my_color != color:
                    await send_ws(websocket, {'type': 'error', 'msg': '还没到你的回合'})
                    continue
                if room.rolled:
                    continue
                await do_roll_dice(room, color)

            # ── 移动棋子 ─────────────────────────────
            elif mtype == 'move_piece':
                if room is None or not room.started or room.winner:
                    continue
                color = room.current_color()
                if my_color != color:
                    await send_ws(websocket, {'type': 'error', 'msg': '还没到你的回合'})
                    continue
                piece_idx = int(msg.get('piece_idx', -1))
                await do_move_piece(room, color, piece_idx)

            # ── 重新开始 ─────────────────────────────
            elif mtype == 'restart':
                if room is None:
                    continue
                # 重置房间
                room.started = False
                room.finished = []
                room.winner = None
                room.rolled = False
                room.movable = []
                room.current_color_idx = 0

                await send_lobby(room)

    except Exception as e:
        log.error("handler error: %s", e)
    finally:
        if room and my_color:
            log.info("[%s] '%s' (%s) 断开连接", room.room_id, room.names.get(my_color, '?'), my_color)

            if room.started:
                # 游戏中断开 → 恢复为AI继续
                room.types[my_color] = 'ai'
                room.names[my_color] = f'AI-{COLOR_NAMES[my_color]}'
                del room.ws_map[my_color]
                await broadcast_room(room, {
                    'type': 'opponent_left',
                    'color': my_color,
                })
                # 通知剩余玩家AI接管
                for c, ws in room.ws_map.items():
                    await send_ws(ws, {
                        'type': 'lobby',
                        'room': room.room_id,
                        'max_players': room.max_players,
                        'my_color': c,
                        'players': room.get_player_list(),
                    })
                # 如果当前轮到断线的玩家，AI接管
                if room.current_color() == my_color and not room.winner:
                    asyncio.create_task(ai_delayed_turn(room))
            else:
                # 大厅中断开
                if my_color in room.ws_map:
                    del room.ws_map[my_color]
                room.types[my_color] = 'ai'
                room.names[my_color] = f'AI-{COLOR_NAMES[my_color]}'

                # 通知其他玩家
                await send_lobby(room)

                # 房间空了就删除
                if not room.ws_map:
                    log.info("[%s] 房间已空，删除", room.room_id)
                    rooms.pop(room.room_id, None)


# ─── 启动 ──────────────────────────────────────────────────

async def main():
    log.info("飞行棋 WebSocket 服务启动 ws://%s:%d", HOST, PORT)
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
