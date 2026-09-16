#!/usr/bin/env bash
set -euo pipefail

PLUGIN="${OPENCODE_LITELLM_PLUGIN_SPEC:-@aproorg/opencode-litellm-headers@git+https://github.com/aproorg/opencode-litellm-headers.git}"
# Not OPENCODE_CONFIG_DIR: other tooling sets that, and we would write into its config.
CONFIG_DIR="${OPENCODE_LITELLM_CONFIG_DIR:-$HOME/.config/opencode}"
CONFIG="$CONFIG_DIR/opencode.json"
TS=$(date +%Y%m%d%H%M%S)

say() { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

ask() {
  local prompt="$1" reply
  if [ "${OPENCODE_ASSUME_YES:-0}" = "1" ]; then return 0; fi
  [ -t 0 ] || [ -e /dev/tty ] || return 1
  read -r -p "$prompt [y/N] " reply < /dev/tty || return 1
  [[ "$reply" =~ ^[Yy] ]]
}

# 1. opencode itself
if ! command -v opencode >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 || fail "opencode is not installed and Homebrew is missing. See https://brew.sh then rerun."
  say "Installing opencode..."
  brew install anomalyco/tap/opencode
fi
say "opencode $(opencode --version 2>/dev/null || echo '?') at $(command -v opencode)"

mkdir -p "$CONFIG_DIR"

# opencode.json is the file we manage; config.json and opencode.jsonc also load and would override it.
for other in "$CONFIG_DIR/opencode.jsonc" "$CONFIG_DIR/config.json"; do
  if [ -f "$other" ]; then
    mv "$other" "$other.bak-$TS"
    say "Moved $(basename "$other") aside — it overrides opencode.json. Old settings: $other.bak-$TS"
  fi
done

# 2. back up before touching anything, and never edit a file we cannot parse
if [ -f "$CONFIG" ]; then
  cp "$CONFIG" "$CONFIG.bak-$TS"
  if ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$CONFIG" 2>/dev/null; then
    mv "$CONFIG" "$CONFIG.unparsed-$TS"
    say "opencode.json has comments or trailing commas and cannot be edited safely."
    say "Kept as $CONFIG.unparsed-$TS — merge anything you need back by hand."
  fi
fi

[ -f "$CONFIG" ] || printf '{\n  "$schema": "https://opencode.ai/config.json"\n}\n' > "$CONFIG"

STALE=$(python3 -c '
import json, sys
config = json.load(open(sys.argv[1]))
print(" ".join(k for k in ("provider", "model", "small_model", "mcp") if k in config))
' "$CONFIG")

STRIP=0
if [ -n "$STALE" ]; then
  say ""
  say "Your config still sets: $STALE"
  say "The plugin manages these now, and your own values take precedence — stale model ids stay in the picker."
  if ask "Remove them (a backup is kept)?"; then STRIP=1; else say "Leaving them; remove them by hand later if the model list looks wrong."; fi
fi

python3 -c '
import json, sys

path, plugin, strip = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
config = json.load(open(path))

config.setdefault("$schema", "https://opencode.ai/config.json")
plugins = [p for p in config.get("plugin", []) if "opencode-litellm-headers" not in str(p)]
config["plugin"] = plugins + [plugin]

if strip:
    for key in ("provider", "model", "small_model", "mcp"):
        config.pop(key, None)

json.dump(config, open(path, "w"), indent=2)
open(path, "a").write("\n")
' "$CONFIG" "$PLUGIN" "$STRIP"
say "Wrote $CONFIG"

# 3. optional runtimes for the local MCP servers
if ! command -v npx >/dev/null 2>&1 && ! command -v bunx >/dev/null 2>&1; then
  say "Note: no npx or bunx found — the local MCP servers are skipped. Models and chat work regardless."
fi
if ! command -v uvx >/dev/null 2>&1; then
  say "Note: no uvx found — the fetch/time/git MCP servers are skipped. Models and chat work regardless."
fi

# 4. first launch: install the plugin, fetch the model list
say ""
say "Setting up (first run downloads the plugin and syncs models)..."
COUNT=$(opencode models 2>/dev/null | grep -cE "^litellm(/|-)" || true)

say ""
if [ "$COUNT" -gt 0 ]; then
  say "Done — $COUNT models available. Start with: opencode"
else
  say "Setup finished, but no models came back."
  say "Check your LiteLLM key is in 1Password as: op://Employee/ai.apro.is litellm/API Key"
  say "Then run: op signin --account aproorg.1password.eu && opencode models"
  exit 1
fi
