import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from datetime import datetime, timezone
from pathlib import Path

from app.database import get_db, AsyncSessionLocal
from app.config import settings
from app.models import Message
from app.ws.handler import websocket_endpoint
from app.api import auth, users, chats, poker


@asynccontextmanager
async def lifespan(app: FastAPI):
    from alembic.config import Config
    from alembic import command

    def _upgrade():
        cfg = Config("alembic.ini")
        cfg.attributes["skip_logging"] = True
        command.upgrade(cfg, "head")

    await asyncio.to_thread(_upgrade)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(cleanup_expired_messages, "interval", hours=1)
    scheduler.start()

    yield

    scheduler.shutdown()


app = FastAPI(title="GandolaChat", lifespan=lifespan)

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

# Mobile PWA bundle (built from mobile/ via `npm run build:web`, copied to
# server/web/). Mounted at /app — the iPhone "Add to Home Screen" PWA lives
# at https://<host>/app/. Missing-directory tolerated so the server starts
# even before the first web build.
_PWA_DIR = Path(__file__).parent.parent / "web"
if _PWA_DIR.is_dir():
    app.mount("/app", StaticFiles(directory=str(_PWA_DIR), html=True), name="pwa")

# Desktop web build (the Electron renderer built for the browser, from
# client/ via `npm run build`, copied to server/web-desktop/). Mounted at
# /desktop. Same renderer as the .exe, minus the Electron-only chrome (hidden
# at runtime via isElectron). The desktop client's vite base is "./" so its
# relative asset URLs resolve correctly under /desktop/.
_DESKTOP_DIR = Path(__file__).parent.parent / "web-desktop"
if _DESKTOP_DIR.is_dir():
    app.mount("/desktop", StaticFiles(directory=str(_DESKTOP_DIR), html=True), name="desktop")


# Root dispatcher: pick the mobile or desktop UI by viewport width + UA, then
# redirect. Keeps a single entry URL (the bare domain) that "just works" on
# any device. The installed iPhone PWA opens /app/ directly (its manifest
# start_url), so it never hits this. Served inline so it loads instantly
# without pulling either 2 MB bundle first.
@app.get("/", response_class=HTMLResponse)
async def root_dispatch():
    return """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GandolaChat</title></head>
<body style="margin:0;background:#0a0a0a">
<script>
(function () {
  var ua = navigator.userAgent || "";
  var isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  var narrow = window.innerWidth > 0 && window.innerWidth < 900;
  var mobile = isMobileUA || narrow;
  location.replace(mobile ? "/app/" : "/desktop/");
})();
</script>
</body></html>"""

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(chats.router)
app.include_router(poker.router)


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



@app.get("/health")
async def health():
    return {"status": "ok"}
