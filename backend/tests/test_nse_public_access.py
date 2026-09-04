from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.core.nse_client import NSEClient
from backend.adapters.kite import KiteAdapter
from backend.shared import nse_access
from backend.shared.nse_access import NSEPublicAccessDisabled


@pytest.fixture(autouse=True)
def _reset_circuit() -> None:
    nse_access.reset_nse_public_circuit()
    yield
    nse_access.reset_nse_public_circuit()


@pytest.mark.asyncio
async def test_nse_client_does_no_io_when_public_access_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nse_access, "get_settings", lambda: SimpleNamespace(nse_public_enabled=False))
    client = NSEClient()

    async def _unexpected_session():
        raise AssertionError("disabled NSE access must not initialize a session")

    monkeypatch.setattr(client, "_get_session", _unexpected_session)

    with pytest.raises(NSEPublicAccessDisabled, match="not enabled"):
        await client.get_quote_equity("AARTECH")


@pytest.mark.asyncio
async def test_first_403_opens_process_circuit_without_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nse_access, "get_settings", lambda: SimpleNamespace(nse_public_enabled=True))

    class _Response:
        status_code = 403

    class _HTTPClient:
        calls = 0

        async def get(self, *_args, **_kwargs):
            self.calls += 1
            return _Response()

    class _Session:
        client = _HTTPClient()

        async def ensure_cookies(self):
            return None

        async def initialize(self):
            raise AssertionError("403 must not refresh and retry")

    session = _Session()
    client = NSEClient()
    monkeypatch.setattr(client, "_get_session", lambda: _async_value(session))

    with pytest.raises(NSEPublicAccessDisabled, match="HTTP 403"):
        await client.get_quote_equity("AARTECH")
    assert session.client.calls == 1

    with pytest.raises(NSEPublicAccessDisabled, match="HTTP 403"):
        await client.get_quote_equity("TCS")
    assert session.client.calls == 1


@pytest.mark.asyncio
async def test_unconfigured_kite_adapter_does_not_touch_disabled_nse(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nse_access, "get_settings", lambda: SimpleNamespace(nse_public_enabled=False))

    class _Kite:
        api_key = None

        def resolve_access_token(self):
            return None

    class _NSE:
        calls = 0

        async def get_quote_equity(self, _symbol):
            self.calls += 1
            raise AssertionError("disabled public NSE must not be called")

    nse = _NSE()
    adapter = KiteAdapter(kite=_Kite(), nse=nse)

    assert await adapter.get_quote("AARTECH") is None
    assert nse.calls == 0


async def _async_value(value):
    return value
