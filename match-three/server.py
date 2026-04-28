"""
消消乐游戏 WebSocket 服务端
=====================================================
功能：
  - 房间管理：两个玩家加入同一房间进行分数比拼
  - 昵称系统：加入房间时携带昵称
  - 计分系统：记录双方分数
  - 再战请求：对局结束后一方发起再战，另一方同意后重新开始
  - 对局记录：记录双方胜负数

消息协议（JSON）：
  客户端 → 服务端:
    { "type": "join",    "room": "xxx", "name": "昵称" }
    { "type": "score",  "score": 100 }                        更新分数
    { "type": "rematch" }                                   申请再战
    { "type": "rematch_reply", "accept": true|false }       回复再战

  服务端 → 客户端:
    { "type": "waiting" }
    { "type": "start",  "names": {"player1":"xxx","player2":"yyy"},
                        "scores": {"玩家A":0,"玩家B":1} }
    { "type": "score_update", "scores": {...} }
    { "type": "over",   "winner": "player1"|"player2"|"draw",
                        "scores": {...} }
    { "type": "rematch_request", "from": "昵称" }
    { "type": "rematch_result", "accepted": true }
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
PORT        = 6794
TURN_SECS   = 60


# ──────────────────────────────────────────────
# 房间管理
# ──────────────────────────────────────────────
class Room:
    def __init__(self, room_id):
        self.room_id = room_id
        self.players = []                              # [ws_player1, ws_player2]
        self.names = {}                                # {ws: name}
        self.scores = {}                               # {name: score}
        self.target_score = 100                       # 目标分数，先达到者获胜
        self.over = False
        self.rematch_state = None
        self.round_num = 1

    def player_index_of(self, ws):
        if len(self.players) > 0 and self.players[0] == ws:
            return 0
        if len(self.players) > 1 and self.players[1] == ws:
            return 1
        return None

    def opponent_of(self, ws):
        if len(self.players) < 2:
            return None
        return self.players[1] if self.players[0] == ws else self.players[0]

    def reset_game(self):
        self.scores = {}
        for ws in self.players:
            name = self.names.get(ws, "玩家")
            self.scores[name] = 0
        self.over = False
        self.rematch_state = None


rooms = {}


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
# 检查是否有人达到目标分数
# ──────────────────────────────────────────────
def check_winner(room):
    for name, score in room.scores.items():
        if score >= room.target_score:
            return name
    return None


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
                    room.scores[player_name] = 0
                    await send(ws, {"type": "waiting"})
                else:
                    room.reset_game()
                    names = {"player1": room.names.get(room.players[0], "玩家1"),
                             "player2": room.names.get(room.players[1], "玩家2")}
                    await send(room.players[0], {
                        "type": "start",
                        "names": names,
                        "scores": room.scores,
                        "round": room.round_num,
                    })
                    await send(room.players[1], {
                        "type": "start",
                        "names": names,
                        "scores": room.scores,
                        "round": room.round_num,
                    })

            # ── 更新分数 ──────────────────────────────
            elif mtype == "score":
                if room is None or room.over:
                    continue

                player_name = room.names.get(ws, "玩家")
                new_score = int(msg.get("score", 0))

                if player_name in room.scores:
                    room.scores[player_name] = new_score
                    await broadcast(room, {"type": "score_update", "scores": room.scores})

                    winner = check_winner(room)
                    if winner:
                        room.over = True
                        await broadcast(room, {
                            "type": "over",
                            "winner": winner,
                            "scores": room.scores
                        })

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
                    room.round_num += 1
                    room.reset_game()
                    log.info("[%s] rematch accepted, starting round %d", room.room_id, room.round_num)
                    await broadcast(room, {"type": "rematch_result", "accepted": True})
                    names = {"player1": room.names.get(room.players[0], "玩家1"),
                             "player2": room.names.get(room.players[1], "玩家2")}
                    await broadcast(room, {
                        "type": "start",
                        "names": names,
                        "scores": room.scores,
                        "round": room.round_num,
                    })
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
            room_id = room.room_id
            rooms.pop(room_id, None)


# ──────────────────────────────────────────────
# 启动
# ──────────────────────────────────────────────
async def main():
    log.info("消消乐 WebSocket 服务启动 ws://%s:%d" % (HOST, PORT))
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
