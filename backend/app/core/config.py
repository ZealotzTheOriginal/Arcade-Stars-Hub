from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# config.py lives at backend/app/core/config.py → project root is 3 levels up
_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[str(_PROJECT_ROOT / ".env"), ".env"],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = "development"
    frontend_url: str = "http://localhost:4200"
    backend_port: int = 8000

    # DeepSeek
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    # Firebase — absolute default so it never depends on cwd
    firebase_service_account_path: str = str(_PROJECT_ROOT / "secrets" / "firebase-service-account.json")
    firebase_project_id: str = ""

    @field_validator("firebase_service_account_path", mode="after")
    @classmethod
    def _resolve_firebase_path(cls, v: str) -> str:
        p = Path(v)
        return str(p) if p.is_absolute() else str(_PROJECT_ROOT / p)


settings = Settings()
