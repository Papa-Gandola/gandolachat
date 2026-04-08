from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://gandola:gandola@localhost:5432/gandolachat"
    SECRET_KEY: str = "change-this-in-production-very-long-secret-key-123"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    UPLOAD_DIR: str = "uploads"
    MAX_FILE_SIZE_MB: int = 50
    MESSAGE_TTL_DAYS: int = 2

    class Config:
        env_file = ".env"


settings = Settings()
