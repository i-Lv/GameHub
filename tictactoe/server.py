"""
井字棋双人对战 WebSocket 服务端
=====================================================
功能：
  - 房间管理：两个玩家加入同一房间即可开始对战
  - 昵称系统：加入房间时携带昵称
  - 轮次控制：X方先手，双方交替落子
  - 30s 倒计时：每轮开始时后端计时，超时自动落子
  - 胜负/平局判断：三子连珠获胜，棋盘满则平局
  - 再战请求：对局结束后一方发起再战，另一方同意后重新开始
  - 对局记录：记录双方胜负数

消息协议（JSON）：
  客户端 → 服务端:
    { "type": "join",    "room": "xxx", "name": "昵称" }
    { "type": "place",   "col": 1, "row": 1 }
    { "type": "undo" }                                      申请悔棋
    { "type": "undo_reply", "accept": true|false }          回复悔棋
    { "type": "rematch" }                                   申请再战
    { "type": "rematch_reply", "accept": true|false }       回复再战

  服务端 → 客户端:
    { "type": "waiting" }
    { "type": "start",  "symbol": "X"|"O",
                        "names": {"X":"xxx","O":"yyy"},
                        "scores": {"玩家A":0,"玩家B":1},
                        "round": 1 }
    { "type": "turn",   "symbol": "X"|"O",
                        "deadline": <unix_ms> }
    { "type": "placed", "col":, "row":,
                        "symbol": "X"|"O" }
    { "type": "over",   "winner": "X"|"O"|"draw",
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
PORT        = 6793
BOARD_SIZE  = 3
WIN_COUNT   = 3
TURN_SECS   = 30
STONE_X     = 1
STONE_O     = 2
STONE_EMPTY = 0

DIRECTIONS = [(1, 0), (0, 1), (1, 1), (1, -1)]


# ──────────────────────────────────────────────
# 房间管理
# ──────────────────────────────────────────────
class Room:
    def __init__(self, room_id):
        self.room_id = room_id
        self.players = []                              # [ws_X, ws_O]
        self.names = {}                                # {ws: name}
        self.board = [[STONE_EMPTY] * BOARD_SIZE for _ in range(BOARD_SIZE)]
        self.current = STONE_X
        self.over = False
        self.move_count = 0
        self.timer_task = None
        self.round_num = 1
        self.scores = {}
        self.rematch_state = None
        self.undo_state = None
        self.undo_requester = None
        self.undo_steps = 0
        self.move_history = []

    def symbol_of(self, ws):
        if len(self.players) > 0 and self.players[0] == ws:
            return STONE_X
        if len(self.players) > 1 and self.players[1] == ws:
            return STONE_O
        return None

    def symbol_name_of(self, ws):
        c = self.symbol_of(ws)
        if c == STONE_X: return "X"
        if c == STONE_O: return "O"
        return None

    def ws_of(self, symbol):
        idx = 0 if symbol == STONE_X else 1
        return self.players[idx] if idx < len(self.players) else None

    def opponent_of(self, ws):
        if len(self.players) < 2:
            return None
        return self.players[1] if self.players[0] == ws else self.players[0]

    def get_display_names(self):
        x_name = self.names.get(self.players[0], "X方") if len(self.players) > 0 else "X方"
        o_name = self.names.get(self.players[1], "O方") if len(self.players) > 1 else "O方"
        return {"X": x_name, "O": o_name}

    def reset_board(self):
        self.board = [[STONE_EMPTY] * BOARD_SIZE for _ in range(BOARD_SIZE)]
        self.current = STONE_X
        self.over = False
        self.move_count = 0
        self.rematch_state = None
        self.undo_state = None
        self.undo_requester = None
        self.undo_steps = 0
        self.move_history = []


rooms = {}


# ──────────────────────────────────────────────
# 胜负判断
# ──────────────────────────────────────────────
def _count_dir(board, col, row, dc, dr, symbol):
    stones = []
    c, r = col + dc, row + dr
    while 0 <= c < BOARD_SIZE and 0 <= r < BOARD_SIZE and board[r][c] == symbol:
        stones.append((c, r))
        c += dc
        r += dr
    return stones


def check_win(board, col, row, symbol):
    for dc, dr in DIRECTIONS:
        pos = _count_dir(board, col, row, dc, dr, symbol)
        neg = _count_dir(board, col, row, -dc, -dr, symbol)
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
    empties = [(c, r)
               for r in range(BOARD_SIZE)
               for c in range(BOARD_SIZE)
               if board[r][c] == STONE_EMPTY]
    return random.choice(empties) if empties else (0, 0)


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
# 执行落子（含胜负判断）
# ──────────────────────────────────────────────
async def do_place(room, col, row, symbol):
    board = room.board
    board[row][col] = symbol
    room.move_count += 1
    room.move_history.append({"col": col, "row": row, "symbol": symbol})

    symbol_name = "X" if symbol == STONE_X else "O"

    await broadcast(room, {
        "type": "placed",
        "col": col, "row": row,
        "symbol": symbol_name,
    })

    win, stones = check_win(board, col, row, symbol)
    if win:
        room.over = True
        winner_name = room.names.get(room.ws_of(symbol), "未知")
        room.scores[winner_name] = room.scores.get(winner_name, 0) + 1
        await broadcast(room, {"type": "over", "winner": symbol_name, "winner_name": winner_name, "stones": stones})
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
    symbol_name = "X" if room.current == STONE_X else "O"

    await broadcast(room, {
        "type": "turn",
        "symbol": symbol_name,
        "deadline": deadline_ms,
    })

    room.timer_task = asyncio.ensure_future(_timeout_task(room, room.current))


async def _timeout_task(room, symbol):
    try:
        await asyncio.sleep(TURN_SECS)
    except asyncio.CancelledError:
        return

    if room.over or room.current != symbol:
        return

    col, row = auto_pick(room.board)
    log.info("[%s] timeout auto-place symbol=%s at (%d,%d)", room.room_id, symbol, col, row)
    ended = await do_place(room, col, row, symbol)
    if not ended:
        room.current = STONE_O if symbol == STONE_X else STONE_X
        await start_turn(room)


# ──────────────────────────────────────────────
# 开始新一局
# ──────────────────────────────────────────────
async def start_new_round(room):
    room.round_num += 1
    room.reset_board()
    names = room.get_display_names()

    await send(room.players[0], {
        "type": "start",
        "symbol": "X",
        "names": names,
        "scores": room.scores,
        "round": room.round_num,
    })
    await send(room.players[1], {
        "type": "start",
        "symbol": "O",
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
                player_name = str(msg.get("name", "")).strip()[:12] or ("玩家%d" % random.randint(100, 999))

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
                    name0 = room.names.get(room.players[0], "玩家0")
                    name1 = room.names.get(room.players[1], "玩家1")
                    if not room.scores:
                        room.scores = {name0: 0, name1: 0}
                    names = room.get_display_names()
                    await send(room.players[0], {
                        "type": "start",
                        "symbol": "X",
                        "names": names,
                        "scores": room.scores,
                        "round": room.round_num,
                    })
                    await send(room.players[1], {
                        "type": "start",
                        "symbol": "O",
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

                my_symbol = room.symbol_of(ws)
                if my_symbol is None:
                    await send(ws, {"type": "error", "msg": "你不在此房间"})
                    continue

                if my_symbol != room.current:
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

                ended = await do_place(room, col, row, my_symbol)
                if not ended:
                    room.current = STONE_O if my_symbol == STONE_X else STONE_X
                    await start_turn(room)

            # ── 申请悔棋 ──────────────────────────────
            elif mtype == "undo":
                if room is None or room.over:
                    await send(ws, {"type": "error", "msg": "当前无法悔棋"})
                    continue
                if len(room.move_history) < 1:
                    await send(ws, {"type": "error", "msg": "没有可以撤回的棋步"})
                    continue
                my_symbol = room.symbol_of(ws)
                steps_to_remove = 0
                for i in range(len(room.move_history) - 1, -1, -1):
                    steps_to_remove += 1
                    if room.move_history[i]["symbol"] == my_symbol:
                        break
                if len(room.move_history) < steps_to_remove:
                    await send(ws, {"type": "error", "msg": "棋步不足，无法悔棋"})
                    continue
                if room.undo_state == "requested":
                    await send(ws, {"type": "error", "msg": "已有悔棋请求待处理"})
                    continue
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
                    requester_symbol = room.symbol_of(requester_ws)
                    removed = []
                    for _ in range(steps):
                        m = room.move_history.pop()
                        room.board[m["row"]][m["col"]] = STONE_EMPTY
                        room.move_count -= 1
                        removed.append({
                            "col": m["col"], "row": m["row"],
                            "symbol": "X" if m["symbol"] == STONE_X else "O",
                        })
                    room.current = requester_symbol
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
    log.info("井字棋 WebSocket 服务启动 ws://%s:%d" % (HOST, PORT))
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
