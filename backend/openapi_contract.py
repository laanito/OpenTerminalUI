"""OpenAPI annotations for the application's real authentication boundary.

Most browser routes are protected by :class:`AuthMiddleware`, which FastAPI
cannot infer while generating OpenAPI. API-key routes read their header through
dependencies rather than FastAPI's security helpers for the same reason. Keep
the generated contract aligned with the middleware and dependency behavior.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI

from backend.auth.deps import auth_exempt_path


HTTP_METHODS = {"get", "post", "put", "patch", "delete"}
API_KEY_SCHEME = "XAPIKey"
BEARER_SCHEME = "HTTPBearer"


def operation_auth(path: str, operation: dict[str, Any]) -> dict[str, str]:
    """Return the effective authentication contract for one operation."""
    security = operation.get("security") or []
    if any(BEARER_SCHEME in requirement for requirement in security):
        return {"scheme": "bearer", "permission": "user"}

    tags = set(operation.get("tags") or ["untagged"])
    if "external-notes" in tags:
        return {"scheme": "api-key", "permission": "read_write"}
    if "public-api" in tags:
        return {"scheme": "api-key", "permission": "read"}

    if not path.startswith("/api") or auth_exempt_path(path):
        return {"scheme": "none", "permission": "public"}
    return {"scheme": "bearer", "permission": "user"}


def apply_auth_contract(schema: dict[str, Any]) -> dict[str, Any]:
    """Annotate an OpenAPI schema with middleware-aware security metadata."""
    security_schemes = schema.setdefault("components", {}).setdefault(
        "securitySchemes", {}
    )
    security_schemes.setdefault(
        BEARER_SCHEME,
        {"type": "http", "scheme": "bearer"},
    )
    security_schemes.setdefault(
        API_KEY_SCHEME,
        {"type": "apiKey", "in": "header", "name": "X-API-Key"},
    )

    for path, path_item in schema.get("paths", {}).items():
        for method, operation in path_item.items():
            if method not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            auth = operation_auth(path, operation)
            operation["x-openterminalui-auth"] = auth
            if auth["scheme"] == "bearer":
                operation["security"] = [{BEARER_SCHEME: []}]
            elif auth["scheme"] == "api-key":
                operation["security"] = [{API_KEY_SCHEME: []}]
            else:
                operation["security"] = []
    return schema


def install_openapi_contract(app: FastAPI) -> None:
    """Install the authentication annotation once on a FastAPI application."""
    base_openapi: Callable[[], dict[str, Any]] = app.openapi

    def contracted_openapi() -> dict[str, Any]:
        schema = base_openapi()
        if not schema.get("x-openterminalui-auth-contract"):
            apply_auth_contract(schema)
            schema["x-openterminalui-auth-contract"] = 1
        return schema

    app.openapi = contracted_openapi  # type: ignore[method-assign]
