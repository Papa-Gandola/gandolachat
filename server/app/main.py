import os
from fastapi import FastAPI, WebSocket, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from datetime import datetime, timezone
from pathlib import Path

from app.database import init_db, get_db, AsyncSessionLocal
from app.config import settings
from app.models import Message
from app.auth import get_current_user
from app.ws.handler import websocket_endpoint
from app.api import auth, users, chats

app = FastAPI(title="GandolaChat")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file serving for uploads
Path(settings.UPLOAD_DIR).mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(chats.router)


@app.websocket("/ws")
async def ws_route(
    websocket: WebSocket,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    from jose import JWTError, jwt
    from app.models import User
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = int(payload["sub"])
    except Exception:
        await websocket.close(code=4001)
        return

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        await websocket.close(code=4001)
        return

    await websocket_endpoint(websocket, user_id, db)


async def cleanup_expired_messages():
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        await db.execute(
            Message.__table__.delete().where(
                Message.expires_at.is_not(None),
                Message.expires_at < now,
            )
        )
        await db.commit()


_scheduler = None

@app.on_event("startup")
async def startup():
    global _scheduler
    await init_db()
    # Preserve existing messages: drop TTL from any rows still carrying one.
    async with AsyncSessionLocal() as db:
        await db.execute(
            Message.__table__.update()
            .where(Message.expires_at.is_not(None))
            .values(expires_at=None)
        )
        await db.commit()
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(cleanup_expired_messages, "interval", hours=1)
    _scheduler.start()


@app.on_event("shutdown")
async def shutdown():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown()


@app.get("/health")
async def health():
    return {"status": "ok"}
