from fastapi import APIRouter, Depends, Header

from app.deps import active_user
from app.models import User
from app.services import model_registry as mr

router = APIRouter(prefix="/api", tags=["models"])


def model_info(m: mr.ResolvedModel, lang: str) -> dict:
    t = m.cfg.thinking
    return {
        "id": m.id,
        "label": mr.pick_label(m.label, lang),
        "provider": m.provider_id,
        "vision": m.cfg.vision,
        "context_window": m.cfg.context_window,
        "image_tokens": m.cfg.image_tokens if m.cfg.vision else None,
        "reasoning": None
        if t is None
        else {
            "levels": [{"id": lv.id, "label": mr.pick_label(lv.label, lang)} for lv in t.levels],
            "default": t.default,
            "returns_text": t.returns_text,
        },
    }


@router.get("/models")
async def get_models(accept_language: str | None = Header(None), _: User = Depends(active_user)):
    lang = mr.lang_from_header(accept_language)
    reg = mr.get_registry()
    sel = mr.selectable(reg)
    active = sel[reg.active_id]
    items = list(sel.values()) if reg.switchable else [active]
    return {
        "switchable": reg.switchable,
        "active": model_info(active, lang),
        "items": [model_info(m, lang) for m in items],
    }
