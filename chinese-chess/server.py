"""
中国象棋双人对战 WebSocket 服务端
=====================================================
功能：
  - 房间管理：两个玩家加入同一房间即可开始对战
  - 昵称系统：加入房间时携带昵称
  - 轮次控制：红方先手，双方交替走棋
  - 30s 倒计时：每轮开始时后端计时，超时判负
  - 完整规则验证：服务端验证所有中国象棋走棋规则
  - 将军/将死判定：检测将军状态和将死/困毙
  - 悔棋请求：对局进行中一方发起悔棋，另一方同意后撤回
  - 再战请求：对局结束后一方发起再战，另一方同意后重新开始
  - 换色规则：每 2 局自动交换红黑执子
  - 对局记录：记录双方胜负数

消息协议（JSON）：
  客户端 → 服务端:
    { "type": "join",    "room": "xxx", "name": "昵称" }
    { "type": "move",    "from": {"row":9,"col":0}, "to": {"row":8,"col":0} }
    { "type": "undo" }                                      申请悔棋
    { "type": "undo_reply", "accept": true|false }          回复悔棋
    { "type": "rematch" }                                   申请再战
    { "type": "rematch_reply", "accept": true|false }       回复再战

  服务端 → 客户端:
    { "type": "waiting" }
    { "type": "start",  "color": "red"|"black",
                        "names": {"red":"xxx","black":"yyy"},
                        "scores": {}, "round": 1 }
    { "type": "turn",   "color": "red"|"black", "deadline": <unix_ms> }
    { "type": "moved",  "from": {"row":0,"col":0}, "to": {"row":2,"col":1},
                        "captured": "車"|null }
    { "type": "check" }                                    将军通知
    { "type": "over",   "winner": "red"|"black"|"draw",
                        "reason": "checkmate"|"stalemate"|"timeout" }
    { "type": "rematch_request", "from": "昵称" }       对手申请再战
    { "type": "rematch_result", "accepted": true }      再战结果
    { "type": "undo_request", "from": "昵称" }          对手申请悔棋
    { "type": "undo_done", "move": {...} }              悔棋完成
    { "type": "undo_rejected" }                          悔棋被拒绝
    { "type": "error",  "msg": "..." }
    { "type": "info",   "msg": "..." }
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
PORT = 6790
TURN_SECS = 30          # 每回合倒计时秒数
SWAP_ROUNDS = 2         # 每 N 局交换红黑

# 颜色常量
COLOR_RED = "red"
COLOR_BLACK = "black"

# 棋子类型
PIECE_KING = "KING"         # 帅/将
PIECE_ADVISOR = "ADVISOR"   # 仕/士
PIECE_ELEPHANT = "ELEPHANT" # 相/象
PIECE_KNIGHT = "KNIGHT"     # 马/馬
PIECE_ROOK = "ROOK"         # 车/車
PIECE_CANNON = "CANNON"     # 炮/砲
PIECE_PAWN = "PAWN"         # 兵/卒

# 红方棋子（使用中文显示名称）
RED_PIECES = {
    PIECE_KING: "帅",
    PIECE_ADVISOR: "仕",
    PIECE_ELEPHANT: "相",
    PIECE_KNIGHT: "马",
    PIECE_ROOK: "车",
    PIECE_CANNON: "炮",
    PIECE_PAWN: "兵",
}

# 黑方棋子（使用中文显示名称）
BLACK_PIECES = {
    PIECE_KING: "将",
    PIECE_ADVISOR: "士",
    PIECE_ELEPHANT: "象",
    PIECE_KNIGHT: "馬",
    PIECE_ROOK: "車",
    PIECE_CANNON: "砲",
    PIECE_PAWN: "卒",
}

# 棋盘尺寸
BOARD_ROWS = 10
BOARD_COLS = 9

# 九宫格范围
RED_PALACE_COLS = range(3, 6)   # 3-5
RED_PALACE_ROWS = range(7, 10)  # 7-9
BLACK_PALACE_COLS = range(3, 6) # 3-5
BLACK_PALACE_ROWS = range(0, 3) # 0-2

# 河界
RIVER_TOP = 4
RIVER_BOTTOM = 5


# ──────────────────────────────────────────────
# 棋子类
# ──────────────────────────────────────────────
class Piece:
    """棋子"""
    def __init__(self, piece_type, color, row, col):
        self.piece_type = piece_type    # 棋子类型
        self.color = color              # red 或 black
        self.row = row                  # 当前行
        self.col = col                  # 当前列
    
    def get_name(self):
        """获取棋子显示名称"""
        if self.color == COLOR_RED:
            return RED_PIECES.get(self.piece_type, "?")
        else:
            return BLACK_PIECES.get(self.piece_type, "?")
    
    def copy(self):
        """复制棋子"""
        return Piece(self.piece_type, self.color, self.row, self.col)
    
    def to_dict(self):
        """序列化为字典"""
        return {
            "type": self.piece_type,
            "color": self.color,
            "name": self.get_name(),
            "row": self.row,
            "col": self.col,
        }


# ──────────────────────────────────────────────
# 棋盘类（包含走棋规则验证）
# ──────────────────────────────────────────────
class ChessBoard:
    """中国象棋棋盘"""
    
    def __init__(self):
        self.board = [[None] * BOARD_COLS for _ in range(BOARD_ROWS)]
        self.move_history = []  # 走棋历史
        self._init_board()
    
    def _init_board(self):
        """初始化棋盘布局"""
        # 黑方（上方）
        self._place_piece(PIECE_ROOK, COLOR_BLACK, 0, 0)
        self._place_piece(PIECE_KNIGHT, COLOR_BLACK, 0, 1)
        self._place_piece(PIECE_ELEPHANT, COLOR_BLACK, 0, 2)
        self._place_piece(PIECE_ADVISOR, COLOR_BLACK, 0, 3)
        self._place_piece(PIECE_KING, COLOR_BLACK, 0, 4)
        self._place_piece(PIECE_ADVISOR, COLOR_BLACK, 0, 5)
        self._place_piece(PIECE_ELEPHANT, COLOR_BLACK, 0, 6)
        self._place_piece(PIECE_KNIGHT, COLOR_BLACK, 0, 7)
        self._place_piece(PIECE_ROOK, COLOR_BLACK, 0, 8)
        self._place_piece(PIECE_CANNON, COLOR_BLACK, 2, 1)
        self._place_piece(PIECE_CANNON, COLOR_BLACK, 2, 7)
        self._place_piece(PIECE_PAWN, COLOR_BLACK, 3, 0)
        self._place_piece(PIECE_PAWN, COLOR_BLACK, 3, 2)
        self._place_piece(PIECE_PAWN, COLOR_BLACK, 3, 4)
        self._place_piece(PIECE_PAWN, COLOR_BLACK, 3, 6)
        self._place_piece(PIECE_PAWN, COLOR_BLACK, 3, 8)
        
        # 红方（下方）
        self._place_piece(PIECE_PAWN, COLOR_RED, 6, 0)
        self._place_piece(PIECE_PAWN, COLOR_RED, 6, 2)
        self._place_piece(PIECE_PAWN, COLOR_RED, 6, 4)
        self._place_piece(PIECE_PAWN, COLOR_RED, 6, 6)
        self._place_piece(PIECE_PAWN, COLOR_RED, 6, 8)
        self._place_piece(PIECE_CANNON, COLOR_RED, 7, 1)
        self._place_piece(PIECE_CANNON, COLOR_RED, 7, 7)
        self._place_piece(PIECE_ROOK, COLOR_RED, 9, 0)
        self._place_piece(PIECE_KNIGHT, COLOR_RED, 9, 1)
        self._place_piece(PIECE_ELEPHANT, COLOR_RED, 9, 2)
        self._place_piece(PIECE_ADVISOR, COLOR_RED, 9, 3)
        self._place_piece(PIECE_KING, COLOR_RED, 9, 4)
        self._place_piece(PIECE_ADVISOR, COLOR_RED, 9, 5)
        self._place_piece(PIECE_ELEPHANT, COLOR_RED, 9, 6)
        self._place_piece(PIECE_KNIGHT, COLOR_RED, 9, 7)
        self._place_piece(PIECE_ROOK, COLOR_RED, 9, 8)
    
    def _place_piece(self, piece_type, color, row, col):
        """放置棋子"""
        piece = Piece(piece_type, color, row, col)
        self.board[row][col] = piece
        return piece
    
    def get_piece(self, row, col):
        """获取指定位置的棋子"""
        if 0 <= row < BOARD_ROWS and 0 <= col < BOARD_COLS:
            return self.board[row][col]
        return None
    
    def copy(self):
        """复制棋盘状态"""
        new_board = ChessBoard.__new__(ChessBoard)
        new_board.board = [[None] * BOARD_COLS for _ in range(BOARD_ROWS)]
        new_board.move_history = list(self.move_history)
        for r in range(BOARD_ROWS):
            for c in range(BOARD_COLS):
                if self.board[r][c]:
                    new_board.board[r][c] = self.board[r][c].copy()
        return new_board
    
    def to_dict(self):
        """序列化为字典"""
        pieces = []
        for r in range(BOARD_ROWS):
            for c in range(BOARD_COLS):
                piece = self.board[r][c]
                if piece:
                    pieces.append(piece.to_dict())
        return {"pieces": pieces}
    
    # ──────────────────────────────────────────────
    # 走棋规则验证
    # ──────────────────────────────────────────────
    
    def is_valid_move(self, from_row, from_col, to_row, to_col, current_color):
        """
        验证走棋是否合法
        返回: (is_valid, error_msg, captured_piece)
        """
        # 基本边界检查
        if not (0 <= from_row < BOARD_ROWS and 0 <= from_col < BOARD_COLS):
            return False, "起始位置越界", None
        if not (0 <= to_row < BOARD_ROWS and 0 <= to_col < BOARD_COLS):
            return False, "目标位置越界", None
        
        # 必须有棋子
        piece = self.board[from_row][from_col]
        if piece is None:
            return False, "起始位置没有棋子", None
        
        # 必须是己方棋子
        if piece.color != current_color:
            return False, "只能移动己方棋子", None
        
        # 不能吃己方棋子
        target = self.board[to_row][to_col]
        if target and target.color == current_color:
            return False, "不能吃己方棋子", None
        
        # 根据棋子类型验证走法
        valid, msg = self._check_piece_move(piece, from_row, from_col, to_row, to_col)
        if not valid:
            return False, msg, None
        
        # 检查是否导致自己被将军
        if self._would_cause_check(from_row, from_col, to_row, to_col, current_color):
            return False, "走棋后己方被将军", None
        
        return True, None, target.get_name() if target else None
    
    def _check_piece_move(self, piece, from_row, from_col, to_row, to_col):
        """根据棋子类型检查走法"""
        dr = to_row - from_row
        dc = to_col - from_col
        
        if piece.piece_type == PIECE_KING:
            return self._check_king_move(piece, from_row, from_col, to_row, to_col, dr, dc)
        elif piece.piece_type == PIECE_ADVISOR:
            return self._check_advisor_move(piece, from_row, from_col, to_row, to_col, dr, dc)
        elif piece.piece_type == PIECE_ELEPHANT:
            return self._check_elephant_move(piece, from_row, from_col, to_row, to_col, dr, dc)
        elif piece.piece_type == PIECE_KNIGHT:
            return self._check_knight_move(from_row, from_col, to_row, to_col, dr, dc)
        elif piece.piece_type == PIECE_ROOK:
            return self._check_rook_move(from_row, from_col, to_row, to_col)
        elif piece.piece_type == PIECE_CANNON:
            return self._check_cannon_move(from_row, from_col, to_row, to_col)
        elif piece.piece_type == PIECE_PAWN:
            return self._check_pawn_move(piece, from_row, from_col, to_row, to_col, dr, dc)
        
        return False, "未知棋子类型"
    
    def _check_king_move(self, piece, from_row, from_col, to_row, to_col, dr, dc):
        """将/帅走法：九宫格内一步直行，不能面对面"""
        # 必须在九宫格内
        if piece.color == COLOR_RED:
            if to_row not in RED_PALACE_ROWS or to_col not in RED_PALACE_COLS:
                return False, "帅不能离开九宫格"
        else:
            if to_row not in BLACK_PALACE_ROWS or to_col not in BLACK_PALACE_COLS:
                return False, "将不能离开九宫格"
        
        # 一步直行
        if abs(dr) + abs(dc) != 1:
            return False, "将/帅只能一步直行"
        
        # 检查是否面对面（飞将）
        if self._is_kings_facing(from_row, from_col, to_row, to_col, piece.color):
            return False, "将帅不能面对面"
        
        return True, None
    
    def _kings_facing(self):
        """检查当前棋盘上两将是否面对面（同列无子阻隔）"""
        red_king_pos = None
        black_king_pos = None
        for r in range(BOARD_ROWS):
            for c in range(BOARD_COLS):
                p = self.board[r][c]
                if p and p.piece_type == PIECE_KING:
                    if p.color == COLOR_RED:
                        red_king_pos = (r, c)
                    else:
                        black_king_pos = (r, c)
        if not red_king_pos or not black_king_pos:
            return False
        if red_king_pos[1] != black_king_pos[1]:
            return False
        min_row = min(red_king_pos[0], black_king_pos[0])
        max_row = max(red_king_pos[0], black_king_pos[0])
        for r in range(min_row + 1, max_row):
            if self.board[r][red_king_pos[1]] is not None:
                return False
        return True

    def _is_kings_facing(self, from_row, from_col, to_row, to_col, color):
        """检查移动后是否导致将帅面对面"""
        # 模拟移动
        moving_piece = self.board[from_row][from_col]
        target_piece = self.board[to_row][to_col]
        
        # 临时移动
        self.board[to_row][to_col] = moving_piece
        self.board[from_row][from_col] = None
        moving_piece.row = to_row
        moving_piece.col = to_col
        
        # 找到双方的将/帅位置
        red_king_pos = None
        black_king_pos = None
        for r in range(BOARD_ROWS):
            for c in range(BOARD_COLS):
                p = self.board[r][c]
                if p and p.piece_type == PIECE_KING:
                    if p.color == COLOR_RED:
                        red_king_pos = (r, c)
                    else:
                        black_king_pos = (r, c)
        
        facing = False
        if red_king_pos and black_king_pos and red_king_pos[1] == black_king_pos[1]:
            # 同一列，检查中间是否有棋子
            has_piece_between = False
            min_row = min(red_king_pos[0], black_king_pos[0])
            max_row = max(red_king_pos[0], black_king_pos[0])
            for r in range(min_row + 1, max_row):
                if self.board[r][red_king_pos[1]] is not None:
                    has_piece_between = True
                    break
            if not has_piece_between:
                facing = True
        
        # 恢复位置
        self.board[from_row][from_col] = moving_piece
        self.board[to_row][to_col] = target_piece
        moving_piece.row = from_row
        moving_piece.col = from_col
        
        return facing
    
    def _check_advisor_move(self, piece, from_row, from_col, to_row, to_col, dr, dc):
        """士/仕走法：九宫格内一步斜行"""
        # 必须在九宫格内
        if piece.color == COLOR_RED:
            if to_row not in RED_PALACE_ROWS or to_col not in RED_PALACE_COLS:
                return False, "仕不能离开九宫格"
        else:
            if to_row not in BLACK_PALACE_ROWS or to_col not in BLACK_PALACE_COLS:
                return False, "士不能离开九宫格"
        
        # 一步斜行
        if abs(dr) != 1 or abs(dc) != 1:
            return False, "士/仕只能一步斜行"
        
        return True, None
    
    def _check_elephant_move(self, piece, from_row, from_col, to_row, to_col, dr, dc):
        """象/相走法：田字走法，不能过河，不能塞象眼"""
        # 田字走法
        if abs(dr) != 2 or abs(dc) != 2:
            return False, "象/相必须走田字"
        
        # 不能过河
        if piece.color == COLOR_RED:
            if to_row < RIVER_BOTTOM:
                return False, "相不能过河"
        else:
            if to_row > RIVER_TOP:
                return False, "象不能过河"
        
        # 检查象眼（田字中心）
        eye_row = (from_row + to_row) // 2
        eye_col = (from_col + to_col) // 2
        if self.board[eye_row][eye_col] is not None:
            return False, "象眼被塞"
        
        return True, None
    
    def _check_knight_move(self, from_row, from_col, to_row, to_col, dr, dc):
        """马/馬走法：日字走法，不能蹩马腿"""
        # 日字走法
        if not ((abs(dr) == 2 and abs(dc) == 1) or (abs(dr) == 1 and abs(dc) == 2)):
            return False, "马必须走日字"
        
        # 检查马腿
        leg_row = from_row
        leg_col = from_col
        if abs(dr) == 2:
            # 纵向走两步，横向走一步
            leg_row = from_row + (1 if dr > 0 else -1)
        else:
            # 横向走两步，纵向走一步
            leg_col = from_col + (1 if dc > 0 else -1)
        
        if self.board[leg_row][leg_col] is not None:
            return False, "马腿被蹩"
        
        return True, None
    
    def _check_rook_move(self, from_row, from_col, to_row, to_col):
        """车/車走法：直线走，不能越子"""
        # 必须直线
        if from_row != to_row and from_col != to_col:
            return False, "车只能直线行走"
        
        # 检查路径上是否有棋子
        if from_row == to_row:
            # 横向移动
            min_col, max_col = min(from_col, to_col), max(from_col, to_col)
            for c in range(min_col + 1, max_col):
                if self.board[from_row][c] is not None:
                    return False, "车不能越子"
        else:
            # 纵向移动
            min_row, max_row = min(from_row, to_row), max(from_row, to_row)
            for r in range(min_row + 1, max_row):
                if self.board[r][from_col] is not None:
                    return False, "车不能越子"
        
        return True, None
    
    def _check_cannon_move(self, from_row, from_col, to_row, to_col):
        """炮/砲走法：直线走，吃子需要隔一个棋子"""
        # 必须直线
        if from_row != to_row and from_col != to_col:
            return False, "炮只能直线行走"
        
        target = self.board[to_row][to_col]
        
        # 计算路径上的棋子数
        pieces_between = 0
        if from_row == to_row:
            min_col, max_col = min(from_col, to_col), max(from_col, to_col)
            for c in range(min_col + 1, max_col):
                if self.board[from_row][c] is not None:
                    pieces_between += 1
        else:
            min_row, max_row = min(from_row, to_row), max(from_row, to_row)
            for r in range(min_row + 1, max_row):
                if self.board[r][from_col] is not None:
                    pieces_between += 1
        
        if target is None:
            # 不吃子，路径上必须没有棋子
            if pieces_between != 0:
                return False, "炮不吃子时不能越子"
        else:
            # 吃子，路径上必须恰好有一个棋子（炮架）
            if pieces_between != 1:
                return False, "炮吃子需要隔一个棋子"
        
        return True, None
    
    def _check_pawn_move(self, piece, from_row, from_col, to_row, to_col, dr, dc):
        """兵/卒走法：过河前只能前进，过河后可前进或左右"""
        direction = -1 if piece.color == COLOR_RED else 1  # 红方向上（行减小），黑方向下（行增大）
        
        # 检查是否过河
        if piece.color == COLOR_RED:
            crossed = from_row < RIVER_BOTTOM
        else:
            crossed = from_row > RIVER_TOP
        
        if not crossed:
            # 未过河，只能前进一步
            if dr != direction or dc != 0:
                return False, "兵/卒未过河只能前进"
        else:
            # 已过河，可以前进或左右，不能后退
            if dr == direction and dc == 0:
                pass  # 前进
            elif dr == 0 and abs(dc) == 1:
                pass  # 左右
            else:
                return False, "兵/卒已过河只能前进或左右移动"
        
        return True, None
    
    def _would_cause_check(self, from_row, from_col, to_row, to_col, color):
        """检查走棋后是否导致自己被将军"""
        # 复制棋盘模拟走棋
        test_board = self.copy()
        
        # 执行模拟走棋
        piece = test_board.board[from_row][from_col]
        test_board.board[to_row][to_col] = piece
        test_board.board[from_row][from_col] = None
        if piece:
            piece.row = to_row
            piece.col = to_col
        
        # 检查是否被将军
        return test_board.is_in_check(color)
    
    def is_in_check(self, color):
        """检查指定颜色是否被将军（含将帅对面）"""
        # 先检查将帅对面
        if self._kings_facing():
            return True
        # 找到己方的将/帅位置
        king_pos = None
        for r in range(BOARD_ROWS):
            for c in range(BOARD_COLS):
                p = self.board[r][c]
                if p and p.piece_type == PIECE_KING and p.color == color:
                    king_pos = (r, c)
                    break
            if king_pos:
                break
        
        if not king_pos:
            return False  # 没有将/帅（不应该发生）
        
        # 检查对方是否有棋子可以攻击到将/帅位置
        opponent_color = COLOR_BLACK if color == COLOR_RED else COLOR_RED
        for r in range(BOARD_ROWS):
            for c in range(BOARD_COLS):
                p = self.board[r][c]
                if p and p.color == opponent_color:
                    # 检查这个棋子是否能走到将/帅位置
                    valid, _ = self._check_piece_move(p, r, c, king_pos[0], king_pos[1])
                    if valid:
                        return True
        
        return False
    
    def find_king(self, color):
        """查找指定颜色的将/帅位置，不存在则返回 None"""
        for r in range(BOARD_ROWS):
            for c in range(BOARD_COLS):
                p = self.board[r][c]
                if p and p.piece_type == PIECE_KING and p.color == color:
                    return (r, c)
        return None
    
    def is_checkmate(self, color):
        """检查是否被将死或困毙"""
        # 如果被将军且无法解除，则为将死
        # 如果没有被将军但无法走任何合法棋步，则为困毙
        
        # 检查是否有任何合法走法
        for from_r in range(BOARD_ROWS):
            for from_c in range(BOARD_COLS):
                piece = self.board[from_r][from_c]
                if piece and piece.color == color:
                    for to_r in range(BOARD_ROWS):
                        for to_c in range(BOARD_COLS):
                            valid, _, _ = self.is_valid_move(from_r, from_c, to_r, to_c, color)
                            if valid:
                                return False  # 有合法走法，未被将死/困毙
        
        return True
    
    def move_piece(self, from_row, from_col, to_row, to_col):
        """执行走棋，返回被吃的棋子（如果有）"""
        piece = self.board[from_row][from_col]
        captured = self.board[to_row][to_col]
        
        # 记录历史
        self.move_history.append({
            "from": {"row": from_row, "col": from_col},
            "to": {"row": to_row, "col": to_col},
            "piece": piece.piece_type if piece else None,
            "color": piece.color if piece else None,
            "captured": captured.piece_type if captured else None,
            "captured_name": captured.get_name() if captured else None,
        })
        
        # 执行移动
        self.board[to_row][to_col] = piece
        self.board[from_row][from_col] = None
        if piece:
            piece.row = to_row
            piece.col = to_col
        
        return captured.get_name() if captured else None
    
    def undo_move(self):
        """撤销最后一步"""
        if not self.move_history:
            return None
        
        move = self.move_history.pop()
        to_row, to_col = move["to"]["row"], move["to"]["col"]
        from_row, from_col = move["from"]["row"], move["from"]["col"]
        
        # 恢复棋子位置
        piece = self.board[to_row][to_col]
        self.board[from_row][from_col] = piece
        if piece:
            piece.row = from_row
            piece.col = from_col
        
        # 恢复被吃的棋子
        if move["captured"]:
            captured_color = COLOR_BLACK if move["color"] == COLOR_RED else COLOR_RED
            captured_piece = Piece(move["captured"], captured_color, to_row, to_col)
            self.board[to_row][to_col] = captured_piece
        else:
            self.board[to_row][to_col] = None
        
        return move


# ──────────────────────────────────────────────
# 房间管理
# ──────────────────────────────────────────────
class Room:
    """游戏房间"""
    def __init__(self, room_id):
        self.room_id = room_id
        self.players = []          # [ws_red, ws_black]
        self.names = {}            # {ws: name}
        self.board = ChessBoard()  # 棋盘
        self.current = COLOR_RED   # 当前轮到谁
        self.over = False          # 是否结束
        self.timer_task = None     # 倒计时任务
        # 对局记录
        self.round_num = 1         # 当前第几局
        self.scores = {}           # {玩家昵称: 得分}
        self.rematch_state = None  # None | "requested"
        self.undo_state = None     # None | "requested"
        self.undo_requester = None # 悔棋发起者的 ws
    
    def color_of(self, ws):
        """获取玩家的颜色"""
        if len(self.players) > 0 and self.players[0] == ws:
            return COLOR_RED
        if len(self.players) > 1 and self.players[1] == ws:
            return COLOR_BLACK
        return None
    
    def ws_of(self, color):
        """获取指定颜色的玩家"""
        idx = 0 if color == COLOR_RED else 1
        return self.players[idx] if idx < len(self.players) else None
    
    def opponent_of(self, ws):
        """获取对手"""
        if len(self.players) < 2:
            return None
        return self.players[1] if self.players[0] == ws else self.players[0]
    
    def get_display_names(self):
        """返回当前红方/黑方的昵称"""
        red_name = self.names.get(self.players[0], "红方") if len(self.players) > 0 else "红方"
        black_name = self.names.get(self.players[1], "黑方") if len(self.players) > 1 else "黑方"
        return {COLOR_RED: red_name, COLOR_BLACK: black_name}
    
    def reset_board(self):
        """重置棋盘准备下一局"""
        self.board = ChessBoard()
        self.current = COLOR_RED
        self.over = False
        self.rematch_state = None
        self.undo_state = None
        self.undo_requester = None
    
    def should_swap(self):
        """检查是否需要交换红黑"""
        return self.round_num > 1 and (self.round_num - 1) % SWAP_ROUNDS == 0
    
    def swap_colors(self):
        """交换双方执子颜色"""
        if len(self.players) < 2:
            return
        self.players.reverse()
        log.info("[%s] round %d — swapped colors", self.room_id, self.round_num)


rooms = {}


# ──────────────────────────────────────────────
# 广播消息
# ──────────────────────────────────────────────
async def send(ws, msg):
    """发送消息给指定客户端"""
    try:
        await ws.send(json.dumps(msg))
    except Exception:
        pass


async def broadcast(room, msg):
    """广播消息给房间内所有玩家"""
    for ws in room.players:
        await send(ws, msg)


# ──────────────────────────────────────────────
# 执行走棋
# ──────────────────────────────────────────────
async def do_move(room, from_row, from_col, to_row, to_col):
    """执行走棋，返回是否游戏结束"""
    # 执行移动
    captured = room.board.move_piece(from_row, from_col, to_row, to_col)
    
    # 广播走棋
    await broadcast(room, {
        "type": "moved",
        "from": {"row": from_row, "col": from_col},
        "to": {"row": to_row, "col": to_col},
        "captured": captured,
    })
    
    # 兜底：吃掉对方将/帅直接判胜
    opponent_color = COLOR_BLACK if room.current == COLOR_RED else COLOR_RED
    opponent_king = room.board.find_king(opponent_color)
    if opponent_king is None:
        room.over = True
        winner_name = room.names.get(room.ws_of(room.current), "未知")
        room.scores[winner_name] = room.scores.get(winner_name, 0) + 1
        await broadcast(room, {
            "type": "over",
            "winner": room.current,
            "reason": "capture_king",
        })
        log.info("[%s] 游戏结束，%s 吃掉对方将/帅获胜", room.room_id, room.current)
        return True
    
    # 检查是否将军
    if room.board.is_in_check(opponent_color):
        await broadcast(room, {"type": "check"})
        log.info("[%s] %s 将军!", room.room_id, room.current)
    
    # 检查是否将死/困毙
    if room.board.is_checkmate(opponent_color):
        room.over = True
        winner_name = room.names.get(room.ws_of(room.current), "未知")
        room.scores[winner_name] = room.scores.get(winner_name, 0) + 1
        reason = "checkmate" if room.board.is_in_check(opponent_color) else "stalemate"
        await broadcast(room, {
            "type": "over",
            "winner": room.current,
            "reason": reason,
        })
        log.info("[%s] 游戏结束，%s 获胜，原因: %s", room.room_id, room.current, reason)
        return True
    
    return False


# ──────────────────────────────────────────────
# 开始新回合（含倒计时）
# ──────────────────────────────────────────────
async def start_turn(room):
    """开始新回合"""
    if room.over:
        return
    
    # 取消之前的倒计时
    if room.timer_task and not room.timer_task.done():
        room.timer_task.cancel()
    
    deadline_ms = int((time.time() + TURN_SECS) * 1000)
    
    await broadcast(room, {
        "type": "turn",
        "color": room.current,
        "deadline": deadline_ms,
    })
    
    room.timer_task = asyncio.ensure_future(_timeout_task(room, room.current))


async def _timeout_task(room, color):
    """倒计时任务"""
    try:
        await asyncio.sleep(TURN_SECS)
    except asyncio.CancelledError:
        return
    
    if room.over or room.current != color:
        return
    
    # 超时判负
    room.over = True
    winner = COLOR_BLACK if color == COLOR_RED else COLOR_RED
    winner_name = room.names.get(room.ws_of(winner), "未知")
    room.scores[winner_name] = room.scores.get(winner_name, 0) + 1
    
    await broadcast(room, {
        "type": "over",
        "winner": winner,
        "reason": "timeout",
    })
    log.info("[%s] %s 超时判负", room.room_id, color)


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
        "color": COLOR_RED,
        "names": names,
        "scores": room.scores,
        "round": room.round_num,
    })
    await send(room.players[1], {
        "type": "start",
        "color": COLOR_BLACK,
        "names": names,
        "scores": room.scores,
        "round": room.round_num,
    })
    await start_turn(room)


# ──────────────────────────────────────────────
# WebSocket 连接处理
# ──────────────────────────────────────────────
async def handler(ws):
    """WebSocket 连接处理器"""
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
                    # 初始化双方分数
                    name0 = room.names.get(room.players[0], "玩家0")
                    name1 = room.names.get(room.players[1], "玩家1")
                    if not room.scores:
                        room.scores = {name0: 0, name1: 0}
                    names = room.get_display_names()
                    await send(room.players[0], {
                        "type": "start",
                        "color": COLOR_RED,
                        "names": names,
                        "scores": room.scores,
                        "round": room.round_num,
                    })
                    await send(room.players[1], {
                        "type": "start",
                        "color": COLOR_BLACK,
                        "names": names,
                        "scores": room.scores,
                        "round": room.round_num,
                    })
                    await start_turn(room)
            
            # ── 走棋 ──────────────────────────────────
            elif mtype == "move":
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
                
                # 解析坐标
                from_pos = msg.get("from", {})
                to_pos = msg.get("to", {})
                from_row = int(from_pos.get("row", -1))
                from_col = int(from_pos.get("col", -1))
                to_row = int(to_pos.get("row", -1))
                to_col = int(to_pos.get("col", -1))
                
                # 验证走棋
                valid, error_msg, captured = room.board.is_valid_move(
                    from_row, from_col, to_row, to_col, my_color
                )
                
                if not valid:
                    await send(ws, {"type": "error", "msg": error_msg})
                    continue
                
                # 取消倒计时
                if room.timer_task and not room.timer_task.done():
                    room.timer_task.cancel()
                
                # 执行走棋
                ended = await do_move(room, from_row, from_col, to_row, to_col)
                if not ended:
                    # 切换回合
                    room.current = COLOR_BLACK if my_color == COLOR_RED else COLOR_RED
                    await start_turn(room)
            
            # ── 申请悔棋 ──────────────────────────────
            elif mtype == "undo":
                if room is None or room.over:
                    await send(ws, {"type": "error", "msg": "当前无法悔棋"})
                    continue
                
                if len(room.board.move_history) < 1:
                    await send(ws, {"type": "error", "msg": "没有可以撤回的棋步"})
                    continue
                
                if room.undo_state == "requested":
                    await send(ws, {"type": "error", "msg": "已有悔棋请求待处理"})
                    continue
                
                my_color = room.color_of(ws)
                my_name = room.names.get(ws, "?")
                opponent = room.opponent_of(ws)
                
                if opponent:
                    room.undo_state = "requested"
                    room.undo_requester = ws
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
                requester_ws = room.undo_requester
                
                if accept and requester_ws:
                    # 撤销一步
                    move = room.board.undo_move()
                    if move:
                        requester_color = room.color_of(requester_ws)
                        room.current = requester_color
                        await broadcast(room, {
                            "type": "undo_done",
                            "move": {
                                "from": move["from"],
                                "to": move["to"],
                                "captured": move["captured_name"],
                            },
                        })
                        log.info("[%s] undo accepted, move undone", room.room_id)
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
            room_id = room.room_id
            rooms.pop(room_id, None)


# ──────────────────────────────────────────────
# 启动
# ──────────────────────────────────────────────
async def main():
    log.info("中国象棋 WebSocket 服务启动 ws://%s:%d" % (HOST, PORT))
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
