from fastapi import APIRouter, Depends

from app.deps import active_user
from app.models import User
from app.services.llm_models import list_models

router = APIRouter(prefix="/api", tags=["models"])


@router.get("/models")
async def get_models(_: User = Depends(active_user)):
    return await list_models()
