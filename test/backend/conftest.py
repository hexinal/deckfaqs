"""Fixtures for the backend tests: a fake `decky` module and a Plugin per test."""

import logging
import sys
import types
from pathlib import Path

import pytest

# Decky Loader injects `decky` at runtime; give main.py something to import.
_decky = types.ModuleType("decky")
_decky.__dict__.update(DECKY_PLUGIN_SETTINGS_DIR="", logger=logging.getLogger("decky"))
sys.modules.setdefault("decky", _decky)

import main  # noqa: E402  (needs the fake decky above)


@pytest.fixture
def settings_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """DECKY_PLUGIN_SETTINGS_DIR for this test (Decky creates it; we don't)."""
    path = tmp_path / "deckfaqs"
    monkeypatch.setattr(main.decky, "DECKY_PLUGIN_SETTINGS_DIR", str(path))
    return path


@pytest.fixture
def plugin(settings_dir: Path) -> main.Plugin:
    """A Plugin whose file lives under `settings_dir`."""
    assert settings_dir
    return main.Plugin()
