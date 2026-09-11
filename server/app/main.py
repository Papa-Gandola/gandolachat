import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
from app.api import auth, users, chats, poker, dota, compendium
from app import apk_mirror


@asynccontextmanager
async def lifespan(app: FastAPI):
    from alembic.config import Config
    from alembic import command

    def _upgrade():
        cfg = Config("alembic.ini")
        cfg.attributes["skip_logging"] = True
        command.upgrade(cfg, "head")

    await asyncio.to_thread(_upgrade)

    # Тизер Гандолиума едет в образе (server/assets/…), но раздаётся из
    # uploads — это docker-том, и файлов образа в нём нет. Синхронизируем
    # при старте: положил новый intro.mp4 в репо → задеплоил → он на месте.
    def _sync_compendium_assets():
        import shutil
        src = Path(__file__).parent.parent / "assets" / "compendium" / "intro.mp4"
        dst = Path(settings.UPLOAD_DIR) / "compendium" / "intro.mp4"
        try:
            if src.is_file() and (not dst.exists() or dst.stat().st_size != src.stat().st_size):
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dst)
        except Exception as e:
            print(f"[compendium] intro sync failed: {type(e).__name__}: {e}")

    await asyncio.to_thread(_sync_compendium_assets)

    from app.compendium import poller as compendium_poller
    from app import apk_mirror

    scheduler = AsyncIOScheduler()
    scheduler.add_job(cleanup_expired_messages, "interval", hours=1)
    # Ночной бэкап базы: 04:00 МСК (01:00 UTC), храним последние 14 дампов.
    # misfire_grace: если сервер спал в 4 утра — догоняем в течение дня.
    from app import backups as backups_mod
    scheduler.add_job(
        backups_mod.run_backup, "cron", hour=1, minute=0,
        misfire_grace_time=12 * 3600, coalesce=True, max_instances=1,
    )
    # Напоминания из «Заметок»: раз в 30с постим созревшие + Web Push.
    from app import notes as notes_mod
    scheduler.add_job(
        notes_mod.fire_due_reminders, "interval",
        seconds=30, max_instances=1, coalesce=True,
    )
    # Зеркало APK: первый прогон сразу при старте (next_run_time=now),
    # дальше проверка раз в 30 минут — новый релиз mobile-latest подтянется
    # сам без передеплоя.
    scheduler.add_job(
        apk_mirror.sync_apk, "interval",
        minutes=30, max_instances=1, coalesce=True,
        next_run_time=datetime.now(timezone.utc),
    )
    # Гандолиум: катки → задания → газ → карточки. Интервалы бережём под
    # бесплатный лимит OpenDota (2000 запросов/день).
    scheduler.add_job(
        compendium_poller.poll_matches, "interval",
        minutes=max(5, settings.DOTA_POLL_MINUTES), max_instances=1, coalesce=True,
    )
    scheduler.add_job(
        compendium_poller.recheck_parses, "interval",
        minutes=20, max_instances=1, coalesce=True,
    )
    scheduler.add_job(
        compendium_poller.refresh_ranks, "interval",
        hours=1, max_instances=1, coalesce=True,
    )
    # Понедельник 03:25 МСК = 00:25 UTC — «Дно недели» (внутри проверка дня).
    # misfire_grace_time: рестарт/даунтайм в понедельник утром не должен
    # оставить чат без трибунала — джоба догонит в течение 20 часов
    # (guard по дню недели в МСК не даст ей уехать на вторник).
    scheduler.add_job(
        compendium_poller.weekly_roast, "cron", hour=0, minute=25,
        misfire_grace_time=20 * 3600, coalesce=True,
    )
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

# PWA bundle for the web client (built from mobile/ via `npm run build:web`,
# output copied to server/web/). Mounted at /app so the iPhone "Add to Home
# Screen" PWA lives at https://<host>/app/. html=True serves index.html on
# directory hits and for unknown subroutes (SPA routing). Missing-directory
# is tolerated so the server starts even before the first web build.
_PWA_DIR = Path(__file__).parent.parent / "web"
if _PWA_DIR.is_dir():
    app.mount("/app", StaticFiles(directory=str(_PWA_DIR), html=True), name="pwa")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(chats.router)
app.include_router(poker.router)
app.include_router(dota.router)
app.include_router(compendium.router)
app.include_router(apk_mirror.router)
from app import notes as _notes
app.include_router(_notes.router)


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
