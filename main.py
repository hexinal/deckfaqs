"""DeckFAQs backend: a plugin-owned file for the last reading positions.

The frontend used to keep them in SteamClient.Storage (Steam's
localconfig.vdf), which Steam only flushes now and then, so a hard power-off
or a plugin reinstall lost them. Here they live in
DECKY_PLUGIN_SETTINGS_DIR/positions.json, written atomically and fsync'd.
"""

import asyncio
import json
import os

import decky

POSITIONS_FILE = "positions.json"


class Plugin:
    _lock = asyncio.Lock()

    @staticmethod
    def _path() -> str:
        return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, POSITIONS_FILE)

    async def load_positions(self):
        """The saved positions, or None when there is no (readable) file yet."""
        path = self._path()
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as e:
            decky.logger.warning("could not read %s: %s", path, e)
            return None
        if not isinstance(data, dict):
            decky.logger.warning("ignoring %s: not an object", path)
            return None
        return data

    async def save_positions(self, positions: dict) -> None:
        """Replace the saved positions (write to a temp file, then rename)."""
        path = self._path()
        tmp = path + ".tmp"
        async with self._lock:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(positions, f, separators=(",", ":"))
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)

    async def _main(self):
        pass

    async def _unload(self):
        pass
