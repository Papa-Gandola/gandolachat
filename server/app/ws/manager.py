import json
from fastapi import WebSocket
from collections import defaultdict


class ConnectionManager:
    def __init__(self):
        # user_id -> WebSocket
        self.active: dict[int, WebSocket] = {}
        # chat_id -> set of user_ids
        self.chat_users: dict[int, set[int]] = defaultdict(set)

    async def connect(self, websocket: WebSocket, user_id: int, chat_ids: list[int]):
        await websocket.accept()
        self.active[user_id] = websocket
        for chat_id in chat_ids:
            self.chat_users[chat_id].add(user_id)

    def disconnect(self, user_id: int, chat_ids: list[int]):
        self.active.pop(user_id, None)
        for chat_id in chat_ids:
            self.chat_users[chat_id].discard(user_id)

    def join_chat(self, user_id: int, chat_id: int):
        self.chat_users[chat_id].add(user_id)

    async def broadcast_to_chat(self, chat_id: int, message: dict, exclude_user: int | None = None):
        user_ids = self.chat_users.get(chat_id, set())
        for uid in user_ids:
            if uid == exclude_user:
                continue
            ws = self.active.get(uid)
            if ws:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass

    async def send_to_user(self, user_id: int, message: dict):
        ws = self.active.get(user_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                pass

    def is_online(self, user_id: int) -> bool:
        return user_id in self.active

    def get_online_user_ids(self) -> set[int]:
        return set(self.active.keys())


manager = ConnectionManager()
