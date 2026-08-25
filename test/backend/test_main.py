"""main.py: the reading-positions file."""

import asyncio
import json
import logging
from pathlib import Path

import pytest

import main

POSITIONS = {"https://g/faqs/1": {"page": "?page=2", "ratio": 0.5, "ts": 1}}


def test_load_returns_none_without_a_file(plugin: main.Plugin) -> None:
    assert asyncio.run(plugin.load_positions()) is None


def test_save_then_load_round_trips(plugin: main.Plugin, settings_dir: Path) -> None:
    asyncio.run(plugin.save_positions(POSITIONS))
    assert asyncio.run(plugin.load_positions()) == POSITIONS
    # Written atomically: the temp file is gone and the content is compact JSON.
    assert sorted(p.name for p in settings_dir.iterdir()) == ["positions.json"]
    assert (settings_dir / "positions.json").read_text() == json.dumps(
        POSITIONS, separators=(",", ":")
    )


def test_save_replaces_the_previous_file(plugin: main.Plugin) -> None:
    asyncio.run(plugin.save_positions(POSITIONS))
    asyncio.run(plugin.save_positions({}))
    assert asyncio.run(plugin.load_positions()) == {}


@pytest.mark.parametrize("content", ["{broken", "[1, 2]", '"text"'])
def test_load_warns_and_returns_none_for_bad_files(
    plugin: main.Plugin,
    settings_dir: Path,
    content: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings_dir.mkdir()
    (settings_dir / "positions.json").write_text(content)
    with caplog.at_level(logging.WARNING, logger="decky"):
        assert asyncio.run(plugin.load_positions()) is None
    assert "positions.json" in caplog.text
