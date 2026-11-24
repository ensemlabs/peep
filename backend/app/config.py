from functools import cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_TRUE = {"true", "1", "yes", "on", "t", "y"}
_FALSE = {"false", "0", "no", "off", "f", "n"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    app_env: str = "production"
    # Comma-separated lists (parsed by the helpers below, not by pydantic-settings JSON decoding)
    app_origins: str = "http://localhost:8090,http://127.0.0.1:8090"
    # Peers whose X-Forwarded-For is trusted. Empty = trust nobody (the TCP peer is the client).
    trusted_proxies: str = ""
    # Built SPA served by the app (the image copies it here); skipped when the directory has no index.html.
    static_dir: str = "/app/static"

    # "auto" (Secure when every APP_ORIGINS entry is https), or an explicit true / false.
    cookie_secure: str = "auto"
    session_idle_days: int = 7
    session_absolute_days: int = 30
    session_refresh_seconds: int = 3600

    database_url: str

    s3_endpoint: str = "http://minio:9000"
    s3_bucket: str = "ensemble-chat"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_startup_timeout_seconds: int = 30

    admin_email: str = ""
    admin_password: str = ""

    # Model registry file (see config/models.example.yaml). Missing file => registry built from LLM_* below.
    models_config: str = "/app/config/models.yaml"
    dev_model_switcher: bool = False  # only used by the LLM_* fallback registry
    secrets_key: str = ""  # Fernet key for plugin header encryption

    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_default_model: str = ""
    llm_models: str = ""  # fallback registry only: extra model ids besides LLM_DEFAULT_MODEL (comma-separated)
    llm_timeout_seconds: float = 300
    replay_enabled: bool = True
    replay_time_scale: float = 1.0  # multiplies fixture delays; tests use 0
    max_upload_mb: int = 200
    max_runs_per_user: int = Field(3, ge=1)

    # Login / registration throttling (see services/throttle.py)
    throttle_window_seconds: int = 15 * 60
    login_max_failures: int = 5
    lock_base_seconds: int = 15 * 60
    lock_max_seconds: int = 24 * 3600
    ip_login_max: int = 30
    reg_max: int = 10
    reg_window_seconds: int = 3600

    @field_validator("cookie_secure")
    @classmethod
    def _cookie_secure_value(cls, v: str) -> str:
        n = v.strip().lower()
        if n == "auto":
            return n
        if n in _TRUE:
            return "true"
        if n in _FALSE:
            return "false"
        raise ValueError("must be auto, true or false")

    @property
    def origins(self) -> set[str]:
        return {o.strip().rstrip("/").lower() for o in self.app_origins.split(",") if o.strip()}

    @property
    def cookie_secure_on(self) -> bool:
        v = self.cookie_secure.strip().lower()
        if v in _TRUE:
            return True
        if v in _FALSE:
            return False
        origins = self.origins
        return bool(origins) and all(o.startswith("https://") for o in origins)

    @property
    def llm_model_allowlist(self) -> list[str]:
        return [m.strip() for m in self.llm_models.split(",") if m.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def trusted_proxy_cidrs(self) -> list[str]:
        return [c.strip() for c in self.trusted_proxies.split(",") if c.strip()]


@cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
