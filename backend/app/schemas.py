import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import User


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def user_json(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
        "status": user.status,
        "created_at": iso(user.created_at),
        "last_login_at": iso(user.last_login_at),
        "approved_at": iso(user.approved_at),
        "token_limit": user.token_limit,
        "token_period": user.token_period,
    }


class _Body(BaseModel):
    model_config = ConfigDict(extra="ignore")


class RegisterBody(_Body):
    email: str
    password: str
    display_name: str


class LoginBody(_Body):
    email: str
    password: str


class ChangePasswordBody(_Body):
    current_password: str
    new_password: str


class AdminPasswordBody(_Body):
    new_password: str


class AdminPatchBody(_Body):
    status: Literal["pending", "active", "disabled"] | None = None
    role: Literal["user", "admin"] | None = None
    # null = remove the limit; omitted = leave unchanged (see model_fields_set)
    token_limit: int | None = Field(None, ge=1, le=1_000_000_000_000)
    token_period: Literal["day", "month"] | None = None


class AdminCreateBody(_Body):
    email: str
    display_name: str
    password: str
    role: Literal["user", "admin"] = "user"
    status: Literal["active", "pending"] = "active"


class AdminBulkBody(_Body):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    action: Literal["approve", "disable", "enable", "delete"]


UserId = uuid.UUID
