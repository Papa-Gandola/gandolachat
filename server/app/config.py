from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://gandola:gandola@localhost:5432/gandolachat"
    SECRET_KEY: str = "change-this-in-production-very-long-secret-key-123"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    UPLOAD_DIR: str = "uploads"
    MAX_FILE_SIZE_MB: int = 50
    MESSAGE_TTL_DAYS: int = 2

    # Web Push (VAPID) for the browser/iOS-PWA clients. Generate once with
    # `python -m app.gen_vapid` and paste the output into .env. If left empty,
    # web push is simply disabled (Expo push for the native APK still works).
    #   VAPID_PUBLIC_KEY  — base64url applicationServerKey handed to the browser
    #   VAPID_PRIVATE_KEY — base64url raw EC private key used to sign pushes
    #   VAPID_SUBJECT     — contact URI, e.g. mailto:you@example.com
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:admin@gandola.chat"

    class Config:
        env_file = ".env"


settings = Settings()
