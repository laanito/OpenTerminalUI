"""Keep documented provider keys available to the deployed backend service."""

from pathlib import Path

import yaml


def test_compose_forwards_fred_key_to_backend() -> None:
    compose_path = Path(__file__).resolve().parents[2] / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
    backend_environment = compose["services"]["backend"]["environment"]
    assert backend_environment["FRED_API_KEY"] == "${FRED_API_KEY:-}"
