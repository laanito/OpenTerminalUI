from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from backend.auth.deps import get_current_user
from backend.models.user import User
from backend.config.settings import get_settings
from backend.services.llm_profiles import resolve_llm_profile
from backend.api.model_lifecycle import model_operation_response
from backend.services.ai_service import AIQueryService, get_ai_query_service

# Mounted under the global "/api" prefix in main.py, so this resolves to /api/ai.
router = APIRouter(prefix="/ai", tags=["ai"])

@router.post("/query", response_model=Dict[str, Any])
async def ai_query(
    request: Request,
    payload: Dict[str, Any],
    service: AIQueryService = Depends(get_ai_query_service),
    current_user: User = Depends(get_current_user),
):
    """Process a natural language query using AI."""
    query_text = payload.get("query")
    context = payload.get("context", {})
    if not isinstance(query_text, str) or not query_text.strip():
        raise HTTPException(status_code=400, detail="Query text is required")
    if not isinstance(context, dict):
        raise HTTPException(status_code=400, detail="Context must be an object")

    data = await service.query(str(current_user.id), query_text, context)
    return data


class AIQueryPayload(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    context: Dict[str, Any] = Field(default_factory=dict)


@router.post("/query/stream")
async def ai_query_stream(
    payload: AIQueryPayload, service: AIQueryService = Depends(get_ai_query_service),
    current_user: User = Depends(get_current_user),
):
    """Classify with Fast, then run existing read-only query actions within one lifecycle.

    Start announces selected identity and the model timeout plus a 60-second
    preparation/action allowance. Rate limits use the authenticated owner.
    No automatic model escalation or browser replay is performed.
    """
    profile = resolve_llm_profile(get_settings(), "query_intent")
    return model_operation_response(lambda: service.query(str(current_user.id), payload.query, payload.context, profile=profile), profile)
