from __future__ import annotations

from backend.plugins.loader import PluginLoader


def test_rediscovery_preserves_runtime_state(tmp_path) -> None:
    plugin_dir = tmp_path / "example"
    plugin_dir.mkdir()
    (plugin_dir / "plugin.yaml").write_text(
        "\n".join(
            [
                "name: example",
                'version: "1.0.0"',
                "author: test",
                "description: test plugin",
                "entry_point: plugins.example",
                "required_permissions: []",
            ]
        ),
        encoding="utf-8",
    )

    loader = PluginLoader(str(tmp_path))
    first = loader.discover()[0]
    first.enabled = True

    second = loader.discover()[0]

    assert second is first
    assert second.enabled is True
