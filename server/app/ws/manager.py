import json
from fastapi import WebSocket
from starlette.websockets import WebSocketState
from collections import defaultdict


class ConnectionManager:
    def __init__(self):
        # user_id -> set of WebSockets (one user may be connected from several
        # devices at once — phone + desktop — so we keep ALL their sockets and
        # fan out to every one of them).
        self.active: dict[int, set[WebSocket]] = defaultdict(set)
        # chat_id -> set of user_ids
        self.chat_users: dict[int, set[int]] = defaultdict(set)
        # chat_id -> set of user_ids currently in a call
        self.active_calls: dict[int, set[int]] = defaultdict(set)
        # chat_id -> metadata about the active call so we can produce a history record
        #   "started_at": epoch seconds when first participant joined,
        #   "initiator": user_id of caller,
        #   "all_participants": set of every user_id that was in the call at any point,
        #   "answered": whether anyone besides the initiator actually joined.
        self.call_meta: dict[int, dict] = {}

    async def connect(self, websocket: WebSocket, user_id: int, chat_ids: list[int]) -> bool:
        """Register a socket. Returns True if this is the user's FIRST active
        connection (so the caller can broadcast a single 'user_online')."""
        await websocket.accept()
        was_offline = len(self.active.get(user_id, set())) == 0
        self.active[user_id].add(websocket)
        for chat_id in chat_ids:
            self.chat_users[chat_id].add(user_id)
        return was_offline

    def disconnect(self, user_id: int, chat_ids: list[int], websocket: WebSocket | None = None) -> bool:
        """Remove one socket. Returns True if the user has NO sockets left
        (so the caller can broadcast a single 'user_offline')."""
        sockets = self.active.get(user_id)
        if sockets is not None and websocket is not None:
            sockets.discard(websocket)
        # No socket passed (legacy) or set drained → treat as full disconnect.
        now_offline = not self.active.get(user_id)
        if now_offline:
            self.active.pop(user_id, None)
            for chat_id in chat_ids:
                self.chat_users[chat_id].discard(user_id)
        return now_offline

    def _drop_dead_socket(self, user_id: int, ws: WebSocket):
        """Remove a dead/failed socket from active state — keeps stale sends
        from happening over and over for the same broken connection."""
        sockets = self.active.get(user_id)
        if sockets is None:
            return
        sockets.discard(ws)
        if not sockets:
            self.active.pop(user_id, None)

    def join_chat(self, user_id: int, chat_id: int):
        self.chat_users[chat_id].add(user_id)

    async def _send(self, ws: WebSocket, message: dict, user_id: int | None = None):
        # Fast-path: skip if the socket is already known-dead. Without this we
        # silently swallow the failure inside send_json and keep the dead WS
        # in `active`, which is how stale sends keep producing "sockets=1 but
        # client receives nothing" repros.
        if ws.application_state != WebSocketState.CONNECTED:
            print(f"[ws] _send skipped: state={ws.application_state.name} user_id={user_id}")
            if user_id is not None:
                self._drop_dead_socket(user_id, ws)
            return
        try:
            await ws.send_json(message)
        except Exception as e:
            print(f"[ws] send_json failed user_id={user_id}: {type(e).__name__}: {e}")
            if user_id is not None:
                self._drop_dead_socket(user_id, ws)

    async def broadcast_to_chat(self, chat_id: int, message: dict, exclude_user: int | None = None):
        user_ids = self.chat_users.get(chat_id, set())
        for uid in user_ids:
            if uid == exclude_user:
                continue
            for ws in list(self.active.get(uid, set())):
                await self._send(ws, message, uid)

    async def send_to_user(self, user_id: int, message: dict):
        for ws in list(self.active.get(user_id, set())):
            await self._send(ws, message, user_id)

    def is_online(self, user_id: int) -> bool:
        return len(self.active.get(user_id, set())) > 0

    def get_online_user_ids(self) -> set[int]:
        return {uid for uid, socks in self.active.items() if socks}


manager = ConnectionManager()
