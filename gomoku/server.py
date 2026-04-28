"""
五子棋双人对战 WebSocket 服务端
=====================================================
功能：
  - 房间管理：两个玩家加入同一房间即可开始对战
  - 昵称系统：加入房间时携带昵称
  - 轮次控制：黑棋先手，双方交替落子
  - 30s 倒计时：每轮开始时后端计时，超时自动落子
  - 自动落子优先级：四个角 → 棋盘上的空位随机
  - 胜负/平局判断：五子连珠获胜，棋盘满则平局
  - 再战请求：对局结束后一方发起再战，另一方同意后重新开始
  - 换色规则：每 2 局自动交换黑白执子
  - 对局记录：记录双方胜负数

消息协议（JSON）：
  客户端 → 服务端:
    { "type": "join",    "room": "xxx", "name": "昵称" }
    { "type": "place",   "col": 7, "row": 7 }
    { "type": "undo" }                                      申请悔棋
    { "type": "undo_reply", "accept": true|false }          回复悔棋
    { "type": "rematch" }                                   申请再战
    { "type": "rematch_reply", "accept": true|false }       回复再战

  服务端 → 客户端:
    { "type": "waiting" }
    { "type": "start",  "color": "black"|"white",
                        "names": {"black":"xxx","white":"yyy"},
                        "scores": {"玩家A":0,"玩家B":1},
                        "round": 1 }
    { "type": "turn",   "color": "black"|"white",
                        "deadline": <unix_ms> }
    { "type": "placed", "col":, "row":,
                        "color": "black"|"white" }
    { "type": "over",   "winner": "black"|"white"|"draw",
                        "stones": [...] }
    { "type": "rematch_request", "from": "昵称" }       对手申请再战
    { "type": "rematch_result", "accepted": true }      再战结果
    { "type": "error",  "msg": "..." }
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

# ──────────────────────────────────────────────
# 常量
# ──────────────────────────────────────────────
HOST        = "0.0.0.0"
PORT        = 6789
BOARD_SIZE  = 15
WIN_COUNT   = 5
TURN_SECS   = 30
SWAP_ROUNDS = 2            # 每 N 局交换黑白
STONE_BLACK = 1
STONE_WHITE = 2
STONE_EMPTY = 0

DIRECTIONS = [(1, 0), (0, 1), (1, 1), (1, -1)]

CORNERS = [
    (0, 0), (BOARD_SIZE - 1, 0),
    (0, BOARD_SIZE - 1), (BOARD_SIZE - 1, BOARD_SIZE - 1),
]


# ──────────────────────────────────────────────
# 房间管理
# ──────────────────────────────────────────────
class Room:
    def __init__(self, room_id):
        self.room_id = room_id
        self.players = []                              # [ws_black, ws_white]
        self.names = {}                                # {ws: name}
        self.board = [[STONE_EMPTY] * BOARD_SIZE for _ in range(BOARD_SIZE)]
        self.current = STONE_BLACK
        self.over = False
        self.move_count = 0
        self.timer_task = None
        # 对局记录
        self.round_num = 1                             # 当前第几局
        self.scores = {}                               # {玩家昵称: 得分}，换色后分数跟着人走
        self.rematch_state = None                      # None | "requested" | "rejected"
        self.undo_state = None                         # None | "requested"
        self.undo_requester = None                     # 悔棋发起者的 ws
        self.undo_steps = 0                            # 要撤回的步数
        self.move_history = []                         # [{col, row, color}, ...] 每步落子记录

    def color_of(self, ws):
        if len(self.players) > 0 and self.players[0] == ws:
            return STONE_BLACK
        if len(self.players) > 1 and self.players[1] == ws:
            return STONE_WHITE
        return None

    def color_name_of(self, ws):
        c = self.color_of(ws)
        if c == STONE_BLACK: return "black"
        if c == STONE_WHITE: return "white"
        return None

    def ws_of(self, color):
        idx = 0 if color == STONE_BLACK else 1
        return self.players[idx] if idx < len(self.players) else None

    def opponent_of(self, ws):
        if len(self.players) < 2:
            return None
        return self.players[1] if self.players[0] == ws else self.players[0]

    def get_display_names(self):
        """返回当前黑方/白方的昵称"""
        bk_name = self.names.get(self.players[0], "黑棋") if len(self.players) > 0 else "黑棋"
        wt_name = self.names.get(self.players[1], "白棋") if len(self.players) > 1 else "白棋"
        return {"black": bk_name, "white": wt_name}

    def reset_board(self):
        """重置棋盘准备下一局"""
        self.board = [[STONE_EMPTY] * BOARD_SIZE for _ in range(BOARD_SIZE)]
        self.current = STONE_BLACK
        self.over = False
        self.move_count = 0
        self.rematch_state = None
        self.undo_state = None
        self.undo_requester = None
        self.undo_steps = 0
        self.move_history = []

    def should_swap(self):
        """检查是否需要交换黑白"""
        return self.round_num > 1 and (self.round_num - 1) % SWAP_ROUNDS == 0

    def swap_colors(self):
        """交换双方执子颜色"""
        if len(self.players) < 2:
            return
        self.players.reverse()
        log.info("[%s] round %d — swapped colors", self.room_id, self.round_num)


rooms = {}


# ──────────────────────────────────────────────
# 胜负判断
# ──────────────────────────────────────────────
def _count_dir(board, col, row, dc, dr, color):
    stones = []
    c, r = col + dc, row + dr
    while 0 <= c < BOARD_SIZE and 0 <= r < BOARD_SIZE and board[r][c] == color:
        stones.append((c, r))
        c += dc
        r += dr
    return stones


def check_win(board, col, row, color):
    for dc, dr in DIRECTIONS:
        pos = _count_dir(board, col, row, dc, dr, color)
        neg = _count_dir(board, col, row, -dc, -dr, color)
        line = neg[::-1] + [(col, row)] + pos
        if len(line) >= WIN_COUNT:
            return True, [{"col": c, "row": r} for c, r in line]
    return False, []


def is_draw(move_count):
    return move_count >= BOARD_SIZE * BOARD_SIZE


# ──────────────────────────────────────────────
# 自动落子选位
# ──────────────────────────────────────────────
def auto_pick(board):
    random.shuffle(CORNERS)
    for c, r in CORNERS:
        if board[r][c] == STONE_EMPTY:
            return c, r
    empties = [(c, r)
               for r in range(BOARD_SIZE)
               for c in range(BOARD_SIZE)
               if board[r][c] == STONE_EMPTY]
    return random.choice(empties)


# ──────────────────────────────────────────────
# 广播消息
# ──────────────────────────────────────────────
async def send(ws, msg):
    try:
        await ws.send(json.dumps(msg))
    except Exception:
        pass


async def broadcast(room, msg):
    for ws in room.players:
        await send(ws, msg)


# ──────────────────────────────────────────────
# 执行落子（含胜负判断），返回是否游戏结束
# ──────────────────────────────────────────────
async def do_place(room, col, row, color):
    board = room.board
    board[row][col] = color
    room.move_count += 1
    room.move_history.append({"col": col, "row": row, "color": color})
    # 安全上限：一局最多 225 步，1000 足够覆盖所有情况
    if len(room.move_history) > 1000:
        room.move_history = room.move_history[-1000:]

    color_name = "black" if color == STONE_BLACK else "white"

    await broadcast(room, {
        "type": "placed",
        "col": col, "row": row,
        "color": color_name,
    })

    win, stones = check_win(board, col, row, color)
    if win:
        room.over = True
        # 分数按玩家昵称存，而非颜色
        winner_name = room.names.get(room.ws_of(color), "未知")
        room.scores[winner_name] = room.scores.get(winner_name, 0) + 1
        await broadcast(room, {"type": "over", "winner": color_name, "winner_name": winner_name, "stones": stones})
        return True

    if is_draw(room.move_count):
        room.over = True
        await broadcast(room, {"type": "over", "winner": "draw", "stones": []})
        return True

    return False


# ──────────────────────────────────────────────
# 开始新回合（含倒计时）
# ──────────────────────────────────────────────
async def start_turn(room):
    if room.over:
        return

    if room.timer_task and not room.timer_task.done():
        room.timer_task.cancel()

    deadline_ms = int((time.time() + TURN_SECS) * 1000)
    color_name  = "black" if room.current == STONE_BLACK else "white"

    await broadcast(room, {
        "type": "turn",
        "color": color_name,
        "deadline": deadline_ms,
    })

    room.timer_task = asyncio.ensure_future(_timeout_task(room, room.current))


async def _timeout_task(room, color):
    try:
        await asyncio.sleep(TURN_SECS)
    except asyncio.CancelledError:
        return

    if room.over or room.current != color:
        return

    col, row = auto_pick(room.board)
    log.info("[%s] timeout auto-place color=%d at (%d,%d)", room.room_id, color, col, row)
    ended = await do_place(room, col, row, color)
    if not ended:
        room.current = STONE_WHITE if color == STONE_BLACK else STONE_BLACK
        await start_turn(room)


# ──────────────────────────────────────────────
# 开始新一局（含换色判定）
# ──────────────────────────────────────────────
async def start_new_round(room):
    """换色（如果需要）→ 重置棋盘 → 广播 start → 开始第一回合"""
    room.round_num += 1

    # 换色判定
    if room.should_swap():
        room.swap_colors()

    room.reset_board()
    names = room.get_display_names()

    await send(room.players[0], {
        "type": "start",
        "color": "black",
        "names": names,
        "scores": room.scores,
        "round": room.round_num,
    })
    await send(room.players[1], {
        "type": "start",
        "color": "white",
        "names": names,
        "scores": room.scores,
        "round": room.round_num,
    })
    await start_turn(room)


# ──────────────────────────────────────────────
# WebSocket 连接处理
# ──────────────────────────────────────────────
async def handler(ws):
    room = None
    try:
        while True:
            try:
                raw = await ws.recv()
            except websockets.exceptions.ConnectionClosed:
                break
            try:
                msg = json.loads(raw)
            except ValueError:
                await send(ws, {"type": "error", "msg": "invalid JSON"})
                continue

            mtype = msg.get("type")

            # ── 加入房间 ──────────────────────────────
            if mtype == "join":
                room_id = str(msg.get("room", "default")).strip() or "default"
                player_name = str(msg.get("name", "")).strip()[:12] or ("玩家%d" % random.randint(100,999))

                if room_id not in rooms:
                    rooms[room_id] = Room(room_id)
                room = rooms[room_id]

                if len(room.players) >= 2:
                    await send(ws, {"type": "error", "msg": "房间已满"})
                    room = None
                    continue

                room.players.append(ws)
                room.names[ws] = player_name
                log.info("[%s] '%s' joined (%d/2)", room_id, player_name, len(room.players))

                if len(room.players) == 1:
                    await send(ws, {"type": "waiting"})
                else:
                    # 初始化双方分数
                    name0 = room.names.get(room.players[0], "玩家0")
                    name1 = room.names.get(room.players[1], "玩家1")
                    if not room.scores:
                        room.scores = {name0: 0, name1: 0}
                    names = room.get_display_names()
                    await send(room.players[0], {
                        "type": "start",
                        "color": "black",
                        "names": names,
                        "scores": room.scores,
                        "round": room.round_num,
                    })
                    await send(room.players[1], {
                        "type": "start",
                        "color": "white",
                        "names": names,
                        "scores": room.scores,
                        "round": room.round_num,
                    })
                    await start_turn(room)

            # ── 落子 ──────────────────────────────────
            elif mtype == "place":
                if room is None or room.over:
                    await send(ws, {"type": "error", "msg": "游戏未开始或已结束"})
                    continue

                my_color = room.color_of(ws)
                if my_color is None:
                    await send(ws, {"type": "error", "msg": "你不在此房间"})
                    continue

                if my_color != room.current:
                    await send(ws, {"type": "error", "msg": "还没到你的回合"})
                    continue

                col = int(msg.get("col", -1))
                row = int(msg.get("row", -1))
                if not (0 <= col < BOARD_SIZE and 0 <= row < BOARD_SIZE):
                    await send(ws, {"type": "error", "msg": "坐标越界"})
                    continue

                if room.board[row][col] != STONE_EMPTY:
                    await send(ws, {"type": "error", "msg": "该位置已有棋子"})
                    continue

                if room.timer_task and not room.timer_task.done():
                    room.timer_task.cancel()

                ended = await do_place(room, col, row, my_color)
                if not ended:
                    room.current = STONE_WHITE if my_color == STONE_BLACK else STONE_BLACK
                    await start_turn(room)

            # ── 申请悔棋 ──────────────────────────────
            # 核心规则：悔棋 = 撤回到"发起方未落子"的状态，落子权归发起方
            #   黑下了白没下 → 黑悔棋撤1步(黑)  → 落子权归黑
            #   黑下了白下了 → 黑悔棋撤2步(白+黑) → 落子权归黑
            #   黑下了白下了 → 白悔棋撤1步(白)  → 落子权归白
            # 需要记录悔棋发起者，在 undo_reply 中使用
            elif mtype == "undo":
                if room is None or room.over:
                    await send(ws, {"type": "error", "msg": "当前无法悔棋"})
                    continue
                if len(room.move_history) < 1:
                    await send(ws, {"type": "error", "msg": "没有可以撤回的棋步"})
                    continue
                my_color = room.color_of(ws)
                # 从末尾向前数，找到自己的最后一步，确定要撤回几步
                steps_to_remove = 0
                for i in range(len(room.move_history) - 1, -1, -1):
                    steps_to_remove += 1
                    if room.move_history[i]["color"] == my_color:
                        break
                if len(room.move_history) < steps_to_remove:
                    await send(ws, {"type": "error", "msg": "棋步不足，无法悔棋"})
                    continue
                if room.undo_state == "requested":
                    await send(ws, {"type": "error", "msg": "已有悔棋请求待处理"})
                    continue
                # 记录悔棋发起者和要撤回的步数，供 undo_reply 使用
                room.undo_requester = ws
                room.undo_steps = steps_to_remove
                my_name = room.names.get(ws, "?")
                opponent = room.opponent_of(ws)
                if opponent:
                    room.undo_state = "requested"
                    await send(opponent, {"type": "undo_request", "from": my_name})
                    await send(ws, {"type": "info", "msg": "已发送悔棋请求，等待对方同意..."})

            # ── 回复悔棋 ──────────────────────────────
            elif mtype == "undo_reply":
                if room is None or room.over:
                    continue
                if room.undo_state != "requested":
                    continue
                accept = msg.get("accept", False)
                room.undo_state = None
                requester_ws = getattr(room, 'undo_requester', None)
                steps = getattr(room, 'undo_steps', 0)
                if accept and requester_ws and steps > 0 and len(room.move_history) >= steps:
                    requester_color = room.color_of(requester_ws)
                    removed = []
                    for _ in range(steps):
                        m = room.move_history.pop()
                        room.board[m["row"]][m["col"]] = STONE_EMPTY
                        room.move_count -= 1
                        removed.append({
                            "col": m["col"], "row": m["row"],
                            "color": "black" if m["color"] == STONE_BLACK else "white",
                        })
                    # 落子权归悔棋发起方
                    room.current = requester_color
                    await broadcast(room, {
                        "type": "undo_done",
                        "moves": removed,
                    })
                    log.info("[%s] undo accepted, removed %d move(s) by %s",
                             room.room_id, steps, room.names.get(requester_ws, "?"))
                    if room.timer_task and not room.timer_task.done():
                        room.timer_task.cancel()
                    await start_turn(room)
                else:
                    await broadcast(room, {"type": "undo_rejected"})

            # ── 申请再战 ──────────────────────────────
            elif mtype == "rematch":
                if room is None or not room.over:
                    await send(ws, {"type": "error", "msg": "当前不在可再战状态"})
                    continue

                if room.rematch_state == "requested":
                    await send(ws, {"type": "error", "msg": "已有再战请求待处理"})
                    continue

                my_name = room.names.get(ws, "?")
                room.rematch_state = "requested"
                log.info("[%s] '%s' requested rematch", room.room_id, my_name)

                opponent = room.opponent_of(ws)
                if opponent:
                    await send(opponent, {
                        "type": "rematch_request",
                        "from": my_name,
                    })
                await send(ws, {"type": "info", "msg": "已发送再战请求，等待对方同意..."})

            # ── 回复再战 ──────────────────────────────
            elif mtype == "rematch_reply":
                if room is None or not room.over:
                    continue
                if room.rematch_state != "requested":
                    continue

                accept = msg.get("accept", False)
                if accept:
                    room.rematch_state = None
                    log.info("[%s] rematch accepted, starting round %d", room.room_id, room.round_num + 1)
                    await broadcast(room, {"type": "rematch_result", "accepted": True})
                    await start_new_round(room)
                else:
                    room.rematch_state = None
                    log.info("[%s] rematch rejected", room.room_id)
                    await broadcast(room, {"type": "rematch_result", "accepted": False})

    except Exception:
        pass
    finally:
        if room and ws in room.players:
            log.info("[%s] '%s' disconnected", room.room_id, room.names.get(ws, "?"))
            opponent = room.opponent_of(ws)
            if opponent:
                await send(opponent, {"type": "opponent_left"})
            if room.timer_task and not room.timer_task.done():
                room.timer_task.cancel()
            room_id = room.room_id
            rooms.pop(room_id, None)


# ──────────────────────────────────────────────
# 启动
# ──────────────────────────────────────────────
async def main():
    log.info("五子棋 WebSocket 服务启动 ws://%s:%d" % (HOST, PORT))
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
