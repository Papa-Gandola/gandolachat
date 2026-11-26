from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://gandola:gandola@localhost:5432/gandolachat"
    SECRET_KEY: str = "change-this-in-production-very-long-secret-key-123"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    UPLOAD_DIR: str = "uploads"
    MAX_FILE_SIZE_MB: int = 50
    MESSAGE_TTL_DAYS: int = 2
    # === Компендиум / Steam ===
    # OpenDota works without a key (free tier: 2000 calls/day) — the key slot
    # is here for the day the chat outgrows that. STEAM_API_KEY is optional
    # and only needed to resolve steamcommunity.com/id/<vanity> links.
    OPENDOTA_API_KEY: str = ""
    STEAM_API_KEY: str = ""
    # VAPID-subject для Web Push (mailto: или https:) — кто «владелец» пушей
    VAPID_SUBJECT: str = "https://2-26-117-77.sslip.io"
    # 20 минут держат ~15-20 привязанных игроков в бесплатном лимите OpenDota
    # (2000 запросов/день) вместе с допарсом и ежечасными рангами.
    DOTA_POLL_MINUTES: int = 20
    # Офсайт-копия ночного дампа по WebDAV. Рекомендуемый приёмник —
    # НЕроссийский (Koofr: https://app.koofr.net/dav/Koofr + app-пароль).
    # Не заданы — выгрузка выключена.
    BACKUP_WEBDAV_URL: str | None = None
    BACKUP_WEBDAV_USER: str | None = None
    BACKUP_WEBDAV_PASSWORD: str | None = None
    # «Нашёл баг»: кому слать репорты — ники (регистр не важен) и/или
    # числовые id через запятую. Пусто = всем админам. Никто из списка не
    # найден (опечатка) — лог и фолбэк на всех админов, репорт не пропадает.
    BUG_REPORT_TO: str = ""
    # === Бот с нейросетью (app/ai.py) ===
    # Провайдер пока один — Gemini (бесплатный тариф Google AI Studio, VPS в
    # Германии ходит напрямую). Без AI_API_KEY бот заводится, но отвечает
    # «ключ не настроен». Модель — строкой, чтобы менять без релиза.
    AI_PROVIDER: str = "gemini"
    AI_API_KEY: str = ""
    AI_MODEL: str = "gemini-3.5-flash"
    # Запасные модели через запятую: бесплатный тариф в час пик отвечает
    # 503 «high demand», а 429 там на каждую модель свой — после повтора
    # на основной бот идёт по этому списку и только потом отшучивается.
    AI_MODEL_FALLBACK: str = "gemini-3.5-flash-lite,gemini-3.1-flash-lite"
    AI_BOT_NAME: str = "b-AI-darka"
    # Файл с ХАРАКТЕРОМ бота (переопределяет DEFAULT_CHARACTER в ai.py; шапка,
    # формат и факты о чате остаются из кода). Читается на каждый вопрос с
    # кэшем по mtime — правка применяется без перезапуска. В compose это
    # /app/config/ai_prompt.txt = config/ai_prompt.txt (В РЕПО: хозяин
    # правит в GitHub, на VPS git pull; каталог config примонтирован).
    # Нет файла / пустой — дефолт из кода.
    AI_PROMPT_FILE: str = "config/ai_prompt.txt"
    AI_DAILY_LIMIT: int = 60          # запросов в сутки (МСК) на человека
    AI_CONTEXT_MESSAGES: int = 30     # память диалога в ЛС

    class Config:
        env_file = ".env"


settings = Settings()
