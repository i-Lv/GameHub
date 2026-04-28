"""
围棋双人对战 WebSocket 服务端
=====================================================
功能：
  - 房间管理：两个玩家加入同一房间即可开始对战
  - 昵称系统：加入房间时携带昵称
  - 轮次控制：黑方先手，双方交替落子
  - 30s 倒计时：每轮开始时后端计时，超时判负
  - 完整规则验证：气的计算、提子、禁入（自杀）、打劫
  - 中国规则数子法：双方连续虚手后自动数目判定胜负
  - 虚手(Pass)：允许弃权落子
  - 认输：允许随时认输
  - 再战请求：对局结束后可再来一局

消息协议（JSON）：
  客户端 → 服务端:
    { "type": "join",    "room": "xxx", "name": "昵称" }
    { "type": "move",    "row": 3, "col": 15 }
    { "type": "pass" }
    { "type": "resign" }
    { "type": "timeout" }
    { "type": "rematch_request" }
    { "type": "rematch_accept" }
    { "type": "rematch_decline" }

  服务端 → 客户端:
    { "type": "waiting" }
    { "type": "joined",  "room_id": "xxx", "color": "black"|"white" }
    { "type": "opponent_joined" }
    { "type": "moved",   "row": 3, "col": 15, "color": "black" }
    { "type": "passed",  "color": "black" }
    { "type": "resigned","winner": "black"|"white" }
    { "type": "over",    "winner": "black"|"white", "reason": "timeout" }
    { "type": "score",   "black": 185.5, "white": 176.0, "winner": "black" }
    { "type": "rematch_request" }
    { "type": "rematch_accepted" }
    { "type": "error",   "message": "..." }
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
# 常量定义
# ──────────────────────────────────────────────
HOST = "0.0.0.0"
PORT = 6792
TURN_SECS = 30
SIZE = 19
KOMI = 7.5
PASS_COUNT_TO_END = 2

EMPTY = 0
BLACK = 1
WHITE = 2

STAR_POINTS = [
    (3, 3), (3, 9), (3, 15),
    (9, 3), (9, 9), (9, 15),
    (15, 3), (15, 9), (15, 15),
]


# ──────────────────────────────────────────────
# 围棋规则引擎
# ──────────────────────────────────────────────
class GoBoard:
    """围棋棋盘"""

    def __init__(self):
        self.board = [[EMPTY] * SIZE for _ in range(SIZE)]
        self.ko_point = None          # 打劫禁着点 [row, col] 或 None
        self.captured_count = {BLACK: 0, WHITE: 0}  # 各方提子数
        self.consecutive_passes = 0

    def neighbors(self, row, col):
        """获取相邻交叉点"""
        n = []
        if row > 0: n.append((row - 1, col))
        if row < SIZE - 1: n.append((row + 1, col))
        if col > 0: n.append((row, col - 1))
        if col < SIZE - 1: n.append((row, col + 1))
        return n

    def get_group(self, row, col):
        """获取连通块及其气数"""
        color = self.board[row][col]
        if color == EMPTY:
            return set(), set()
        visited = set()
        stones = set()
        liberties = set()
        stack = [(row, col)]
        while stack:
            r, c = stack.pop()
            key = r * SIZE + c
            if key in visited:
                continue
            visited.add(key)
            stones.add((r, c))
            for nr, nc in self.neighbors(r, c):
                nk = nr * SIZE + nc
                if nk in visited:
                    continue
                if self.board[nr][nc] == EMPTY:
                    liberties.add(nk)
                elif self.board[nr][nc] == color:
                    stack.append((nr, nc))
        return stones, liberties

    def is_legal(self, row, col, color):
        """检查落子是否合法"""
        if row < 0 or row >= SIZE or col < 0 or col >= SIZE:
            return False
        if self.board[row][col] != EMPTY:
            return False
        if self.ko_point and self.ko_point == (row, col):
            return False

        # 尝试落子
        self.board[row][col] = color
        opp = WHITE if color == BLACK else BLACK

        # 检查是否提对方的子
        captured = False
        for nr, nc in self.neighbors(row, col):
            if self.board[nr][nc] == opp:
                _, libs = self.get_group(nr, nc)
                if len(libs) == 0:
                    captured = True
                    break

        if not captured:
            # 检查自杀
            _, self_libs = self.get_group(row, col)
            if len(self_libs) == 0:
                self.board[row][col] = EMPTY
                return False

        self.board[row][col] = EMPTY
        return True

    def place_stone(self, row, col, color):
        """执行落子，返回被提的子列表"""
        self.board[row][col] = color
        opp = WHITE if color == BLACK else BLACK
        all_captured = []
        single_capture = None

        for nr, nc in self.neighbors(row, col):
            if self.board[nr][nc] == opp:
                stones, libs = self.get_group(nr, nc)
                if len(libs) == 0:
                    for sr, sc in stones:
                        self.board[sr][sc] = EMPTY
                        all_captured.append((sr, sc))
                    if len(stones) == 1:
                        single_capture = list(stones)[0]

        self.captured_count[color] += len(all_captured)
        self.consecutive_passes = 0

        # 打劫判定
        new_ko = None
        if single_capture and len(all_captured) == 1:
            self_stones, self_libs = self.get_group(row, col)
            if len(self_stones) == 1 and len(self_libs) == 1:
                new_ko = single_capture

        self.ko_point = new_ko
        return all_captured

    def pass_turn(self, color):
        """虚手"""
        self.consecutive_passes += 1
        self.ko_point = None

    def calculate_score(self):
        """中国规则数子法"""
        territory = {BLACK: 0, WHITE: 0}
        stones_count = {BLACK: 0, WHITE: 0}
        visited = set()

        for r in range(SIZE):
            for c in range(SIZE):
                if self.board[r][c] == BLACK:
                    stones_count[BLACK] += 1
                elif self.board[r][c] == WHITE:
                    stones_count[WHITE] += 1
                elif (r * SIZE + c) not in visited:
                    region = []
                    borders = set()
                    stack = [(r, c)]
                    while stack:
                        cr, cc = stack.pop()
                        key = cr * SIZE + cc
                        if key in visited:
                            continue
                        visited.add(key)
                        region.append((cr, cc))
                        for nr, nc in self.neighbors(cr, cc):
                            nk = nr * SIZE + nc
                            if self.board[nr][nc] == EMPTY:
                                if nk not in visited:
                                    stack.append((nr, nc))
                            else:
                                borders.add(self.board[nr][nc])
                    if len(borders) == 1:
                        owner = list(borders)[0]
                        territory[owner] += len(region)

        black_total = stones_count[BLACK] + territory[BLACK]
        white_total = stones_count[WHITE] + territory[WHITE] + KOMI

        return {
            "black": black_total,
            "white": white_total,
            "blackTerritory": territory[BLACK],
            "whiteTerritory": territory[WHITE],
            "blackStones": stones_count[BLACK],
            "whiteStones": stones_count[WHITE],
            "winner": BLACK if black_total > white_total else WHITE,
            "margin": abs(black_total - white_total),
        }

    def reset(self):
        """重置棋盘"""
        self.__init__()


# ──────────────────────────────────────────────
# 房间管理
# ──────────────────────────────────────────────
class Room:
    def __init__(self, room_id):
        self.room_id = room_id
        self.players = []
        self.names = {}
        self.board = GoBoard()
        self.current = BLACK
        self.over = False
        self.timer_task = None
        self.round_num = 1
        self.scores = {}
        self.rematch_state = None

    def color_of(self, ws):
        if len(self.players) > 0 and self.players[0] == ws:
            return BLACK
        if len(self.players) > 1 and self.players[1] == ws:
            return WHITE
        return None

    def ws_of(self, color):
        idx = 0 if color == BLACK else 1
        return self.players[idx] if idx < len(self.players) else None

    def opponent_of(self, ws):
        if len(self.players) < 2:
            return None
        return self.players[1] if self.players[0] == ws else self.players[0]

    def reset_game(self):
        self.board = GoBoard()
        self.current = BLACK
        self.over = False
        self.rematch_state = None
        if self.timer_task and not self.timer_task.done():
            self.timer_task.cancel()


rooms = {}


# ──────────────────────────────────────────────
# 消息发送
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
# 倒计时
# ──────────────────────────────────────────────
async def start_turn(room):
    if room.over:
        return
    if room.timer_task and not room.timer_task.done():
        room.timer_task.cancel()
    room.timer_task = asyncio.ensure_future(_timeout_task(room, room.current))


async def _timeout_task(room, color):
    try:
        await asyncio.sleep(TURN_SECS)
    except asyncio.CancelledError:
        return
    if room.over or room.current != color:
        return
    room.over = True
    winner = WHITE if color == BLACK else BLACK
    await broadcast(room, {
        "type": "over",
        "winner": winner,
        "reason": "timeout",
    })
    log.info("[%s] %s 超时判负", room.room_id, "黑方" if color == BLACK else "白方")


# ──────────────────────────────────────────────
# WebSocket 处理
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
                await send(ws, {"type": "error", "message": "invalid JSON"})
                continue

            mtype = msg.get("type")

            # ── 加入房间 ──
            if mtype == "join":
                room_id = str(msg.get("room", "")).strip() or None
                player_name = str(msg.get("name", "")).strip()[:12] or ("玩家%d" % random.randint(100, 999))

                if not room_id:
                    room_id = "%04d" % random.randint(0, 9999)

                if room_id not in rooms:
                    rooms[room_id] = Room(room_id)
                room = rooms[room_id]

                if len(room.players) >= 2:
                    await send(ws, {"type": "error", "message": "房间已满"})
                    room = None
                    continue

                room.players.append(ws)
                room.names[ws] = player_name
                my_color = room.color_of(ws)
                color_str = "black" if my_color == BLACK else "white"
                log.info("[%s] '%s' joined as %s (%d/2)", room_id, player_name, color_str, len(room.players))

                await send(ws, {
                    "type": "joined",
                    "room_id": room_id,
                    "color": color_str,
                })

                if len(room.players) == 2:
                    # 双方初始分数
                    for p in room.players:
                        n = room.names.get(p, "玩家")
                        if n not in room.scores:
                            room.scores[n] = 0

                    await broadcast(room, {"type": "opponent_joined"})
                    await start_turn(room)

            # ── 落子 ──
            elif mtype == "move":
                if room is None or room.over:
                    await send(ws, {"type": "error", "message": "游戏未开始或已结束"})
                    continue

                my_color = room.color_of(ws)
                if my_color is None or my_color != room.current:
                    await send(ws, {"type": "error", "message": "还没到你的回合"})
                    continue

                row = int(msg.get("row", -1))
                col = int(msg.get("col", -1))

                if not room.board.is_legal(row, col, my_color):
                    await send(ws, {"type": "error", "message": "非法落子"})
                    continue

                # 取消倒计时
                if room.timer_task and not room.timer_task.done():
                    room.timer_task.cancel()

                # 执行落子
                captured = room.board.place_stone(row, col, my_color)
                color_str = "black" if my_color == BLACK else "white"

                await broadcast(room, {
                    "type": "moved",
                    "row": row,
                    "col": col,
                    "color": color_str,
                })

                # 切换
                room.current = WHITE if my_color == BLACK else BLACK
                await start_turn(room)

            # ── 虚手 ──
            elif mtype == "pass":
                if room is None or room.over:
                    continue

                my_color = room.color_of(ws)
                if my_color is None or my_color != room.current:
                    await send(ws, {"type": "error", "message": "还没到你的回合"})
                    continue

                if room.timer_task and not room.timer_task.done():
                    room.timer_task.cancel()

                room.board.pass_turn(my_color)
                color_str = "black" if my_color == BLACK else "white"

                await broadcast(room, {
                    "type": "passed",
                    "color": color_str,
                })

                room.current = WHITE if my_color == BLACK else BLACK

                # 双方连续 pass → 终局数目
                if room.board.consecutive_passes >= PASS_COUNT_TO_END:
                    room.over = True
                    score = room.board.calculate_score()
                    winner_str = "black" if score["winner"] == BLACK else "white"
                    await broadcast(room, {
                        "type": "score",
                        "black": score["black"],
                        "white": score["white"],
                        "winner": winner_str,
                    })
                    log.info("[%s] 终局 — 黑 %.1f vs 白 %.1f, %s胜",
                             room.room_id, score["black"], score["white"],
                             "黑" if score["winner"] == BLACK else "白")
                else:
                    await start_turn(room)

            # ── 认输 ──
            elif mtype == "resign":
                if room is None or room.over:
                    continue

                my_color = room.color_of(ws)
                if my_color is None:
                    continue

                room.over = True
                if room.timer_task and not room.timer_task.done():
                    room.timer_task.cancel()

                winner = WHITE if my_color == BLACK else BLACK
                winner_str = "black" if winner == BLACK else "white"

                await broadcast(room, {
                    "type": "resigned",
                    "winner": winner_str,
                })
                log.info("[%s] %s认输", room.room_id, "黑方" if my_color == BLACK else "白方")

            # ── 超时（客户端上报） ──
            elif mtype == "timeout":
                if room is None or room.over:
                    continue
                # 由服务端统一管理超时，客户端只负责显示
                pass

            # ── 再战请求 ──
            elif mtype == "rematch_request":
                if room is None or not room.over:
                    continue
                if room.rematch_state == "requested":
                    continue

                room.rematch_state = "requested"
                opponent = room.opponent_of(ws)
                if opponent:
                    await send(opponent, {"type": "rematch_request"})
                await send(ws, {"type": "info", "msg": "已发送再战请求"})

            # ── 接受再战 ──
            elif mtype == "rematch_accept":
                if room is None or not room.over:
                    continue
                if room.rematch_state != "requested":
                    continue

                room.rematch_state = None
                room.round_num += 1
                room.reset_game()
                log.info("[%s] 再战，第 %d 局", room.room_id, room.round_num)
                await broadcast(room, {"type": "rematch_accepted"})
                await start_turn(room)

            # ── 拒绝再战 ──
            elif mtype == "rematch_decline":
                if room is None:
                    continue
                room.rematch_state = None
                await broadcast(room, {"type": "info", "msg": "对手拒绝了再战请求"})

    except Exception as e:
        log.error("Handler error: %s", e)
    finally:
        if room and ws in room.players:
            log.info("[%s] '%s' disconnected", room.room_id, room.names.get(ws, "?"))
            opponent = room.opponent_of(ws)
            if opponent:
                await send(opponent, {"type": "opponent_left"})
            if room.timer_task and not room.timer_task.done():
                room.timer_task.cancel()
            room.players.remove(ws)
            if not room.players:
                rooms.pop(room.room_id, None)


# ──────────────────────────────────────────────
# 启动
# ──────────────────────────────────────────────
async def main():
    log.info("围棋 WebSocket 服务启动 ws://%s:%d", HOST, PORT)
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
