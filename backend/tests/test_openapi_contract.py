from __future__ import annotations

from backend.main import app


def test_openapi_describes_middleware_bearer_auth() -> None:
    operation = app.openapi()["paths"]["/api/charts/volume-profile/{symbol}"]["get"]

    assert operation["security"] == [{"HTTPBearer": []}]
    assert operation["x-openterminalui-auth"] == {
        "scheme": "bearer",
        "permission": "user",
    }


def test_openapi_describes_api_key_permissions() -> None:
    schema = app.openapi()
    read_operation = schema["paths"]["/api/v1/quote/{symbol}"]["get"]
    write_operation = schema["paths"]["/api/v1/notes/external"]["put"]

    assert schema["components"]["securitySchemes"]["XAPIKey"] == {
        "type": "apiKey",
        "in": "header",
        "name": "X-API-Key",
    }
    assert read_operation["security"] == [{"XAPIKey": []}]
    assert read_operation["x-openterminalui-auth"]["permission"] == "read"
    assert write_operation["security"] == [{"XAPIKey": []}]
    assert write_operation["x-openterminalui-auth"]["permission"] == "read_write"


def test_openapi_marks_exempt_routes_as_public() -> None:
    schema = app.openapi()

    assert schema["paths"]["/health"]["get"]["security"] == []
    assert schema["paths"]["/api/auth/login"]["post"]["security"] == []
    assert schema["paths"]["/api/v1/crypto/search"]["get"]["security"] == []
