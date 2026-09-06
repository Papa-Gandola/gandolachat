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
    # 20 минут держат ~15-20 привязанных игроков в бесплатном лимите OpenDota
    # (2000 запросов/день) вместе с допарсом и ежечасными рангами.
    DOTA_POLL_MINUTES: int = 20

    class Config:
        env_file = ".env"


settings = Settings()
