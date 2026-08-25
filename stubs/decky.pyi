"""Type stub for the `decky` module Decky Loader injects into plugin backends.

Only the part main.py uses is declared; see
https://github.com/SteamDeckHomebrew/decky-loader/blob/main/backend/decky_loader/plugin/imports/decky.pyi
for the full API.
"""

import logging

DECKY_PLUGIN_SETTINGS_DIR: str
"""Recommended directory for configuration files (created automatically)."""

logger: logging.Logger
"""The main plugin logger, writing to DECKY_PLUGIN_LOG."""
