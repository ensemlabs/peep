"""Fernet encryption for plugin header values (key: SECRETS_KEY). Plaintext is never logged or returned."""

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings
from app.errors import ApiError


class SecretsNotConfigured(RuntimeError):
    pass


def _fernet() -> Fernet:
    key = get_settings().secrets_key.strip()
    if not key:
        raise SecretsNotConfigured(
            "SECRETS_KEY is not set. Generate one with: "
            'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
    try:
        return Fernet(key.encode())
    except ValueError:
        raise SecretsNotConfigured("SECRETS_KEY is not a valid Fernet key (32 url-safe base64-encoded bytes)") from None


def validate_key_configured() -> None:
    _fernet()


def encrypt(value: str) -> str:
    try:
        return _fernet().encrypt(value.encode()).decode()
    except SecretsNotConfigured as e:
        raise ApiError(503, "secrets_not_configured", "Secret storage is not configured on the server") from e


def check_token(token: str) -> bool:
    """True if `token` decrypts with the configured key (used by the startup check)."""
    try:
        _fernet().decrypt(token.encode())
        return True
    except (InvalidToken, SecretsNotConfigured):
        return False


def decrypt(token: str) -> str:
    """Decrypt a stored header value. Used by the startup check and, later, by whatever calls the MCP servers."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, SecretsNotConfigured):
        raise ApiError(500, "secret_unreadable", "Stored secret cannot be decrypted") from None
