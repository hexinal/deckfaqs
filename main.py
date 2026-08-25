"""DeckFAQs backend: a plugin-owned file for the last reading positions.

The frontend used to keep them in SteamClient.Storage (Steam's
localconfig.vdf), which Steam only flushes now and then, so a hard power-off
or a plugin reinstall lost them. Here they live in
DECKY_PLUGIN_SETTINGS_DIR/positions.json, written atomically and fsync'd.
"""

import asyncio
import json
import os
from collections.abc import Mapping
from pathlib import Path

import decky

POSITIONS_FILE = "positions.json"

Positions = dict[str, object]


def _read(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, positions: Mapping[str, object]) -> None:
    """Write to a temp file, fsync, then rename over the old one."""
    tmp = path.with_suffix(".json.tmp")
    path.parent.mkdir(parents=True, exist_ok=True)
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(positions, f, separators=(",", ":"))
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(path)


class Plugin:
    """Decky entry point: every public coroutine is a `call()` route."""

    _lock = asyncio.Lock()

    @staticmethod
    def _path() -> Path:
        return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / POSITIONS_FILE

    async def load_positions(self) -> Positions | None:
        """Return the saved positions, or None when there is no (readable) file."""
        path = self._path()
        try:
            data = await asyncio.to_thread(_read, path)
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as e:
            decky.logger.warning("could not read %s: %s", path, e)
            return None
        if not isinstance(data, dict):
            decky.logger.warning("ignoring %s: not an object", path)
            return None
        return data

    async def save_positions(self, positions: Mapping[str, object]) -> None:
        """Replace the saved positions."""
        async with self._lock:
            await asyncio.to_thread(_write, self._path(), positions)

    async def _main(self) -> None:
        """Nothing runs in the background."""

    async def _unload(self) -> None:
        """Nothing to stop."""
