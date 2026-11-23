import hashlib
import ipaddress
import secrets
from functools import cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Request
from starlette.concurrency import run_in_threadpool

from app.config import get_settings

_hasher = PasswordHasher()
_dummy_hash: str | None = None

PASSWORD_MIN, PASSWORD_MAX = 10, 128


def normalize_email(email: str) -> str:
    return email.strip().lower()


def email_is_valid(email: str) -> bool:
    local, sep, domain = email.partition("@")
    return bool(sep and local and domain and "@" not in domain and len(email) <= 254 and not any(c.isspace() for c in email))


def password_problem(password: str, email: str) -> str | None:
    if not PASSWORD_MIN <= len(password) <= PASSWORD_MAX:
        return f"Password must be {PASSWORD_MIN}-{PASSWORD_MAX} characters"
    if password.lower() == email.strip().lower():
        return "Password must not equal the email"
    return None


async def hash_password(password: str) -> str:
    return await run_in_threadpool(_hasher.hash, password)


async def verify_password(password_hash: str, password: str) -> bool:
    def _verify() -> bool:
        try:
            return _hasher.verify(password_hash, password)
        except (VerificationError, InvalidHashError):
            return False

    return await run_in_threadpool(_verify)


async def verify_dummy(password: str) -> None:
    """Burn the same CPU as a real verification (unknown email) so timing does not leak existence."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = await hash_password("dummy-password-for-timing")
    await verify_password(_dummy_hash, password)


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


@cache
def _trusted_networks(spec: tuple[str, ...]) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    return tuple(ipaddress.ip_network(c, strict=False) for c in spec)


def client_ip(request: Request) -> str:
    """Peer IP, or the first X-Forwarded-For hop when the peer is a trusted proxy."""
    peer = request.client.host if request.client else "unknown"
    try:
        peer_ip = ipaddress.ip_address(peer)
    except ValueError:
        return peer
    nets = _trusted_networks(tuple(get_settings().trusted_proxy_cidrs))
    if any(peer_ip in n for n in nets):
        xff = request.headers.get("x-forwarded-for", "")
        first = xff.split(",")[0].strip()
        try:
            return str(ipaddress.ip_address(first))
        except ValueError:
            pass
    return str(peer_ip)
