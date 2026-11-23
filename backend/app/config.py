from functools import cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    app_env: str = "production"
    # Comma-separated lists (parsed by the helpers below, not by pydantic-settings JSON decoding)
    app_origins: str = "http://localhost:8090,http://127.0.0.1:8090"
    trusted_proxies: str = "172.16.0.0/12,10.0.0.0/8,192.168.0.0/16"

    cookie_secure: bool = False
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

    llm_base_url: str = "http://llm-proxy-ts:8000/v1"
    llm_api_key: str = ""
    llm_default_model: str = "gemini-pro"
    llm_models: str = ""  # comma-separated allowlist (order kept); empty = everything upstream offers
    llm_timeout_seconds: float = 300
    replay_enabled: bool = True
    replay_time_scale: float = 1.0  # multiplies fixture delays; tests use 0
    max_upload_mb: int = 200

    # Login / registration throttling (see services/throttle.py)
    throttle_window_seconds: int = 15 * 60
    login_max_failures: int = 5
    lock_base_seconds: int = 15 * 60
    lock_max_seconds: int = 24 * 3600
    ip_login_max: int = 30
    reg_max: int = 10
    reg_window_seconds: int = 3600

    @property
    def origins(self) -> set[str]:
        return {o.strip().rstrip("/").lower() for o in self.app_origins.split(",") if o.strip()}

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
