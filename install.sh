#!/usr/bin/env bash
set -euo pipefail

PLUGIN="${OPENCODE_LITELLM_PLUGIN_SPEC:-@aproorg/opencode-litellm-headers@git+https://github.com/aproorg/opencode-litellm-headers.git}"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
CONFIG="$CONFIG_DIR/opencode.json"

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
  brew install opencode
fi
say "opencode $(opencode --version 2>/dev/null || echo '?') at $(command -v opencode)"

# 2. config: add the plugin, retire settings the plugin now manages
mkdir -p "$CONFIG_DIR"
[ -f "$CONFIG" ] || printf '{\n  "$schema": "https://opencode.ai/config.json"\n}\n' > "$CONFIG"

STALE=$(python3 - "$CONFIG" <<'PY'
import json, sys
try:
    config = json.load(open(sys.argv[1]))
except Exception:
    config = {}
managed = [k for k in ("provider", "model", "small_model", "mcp") if k in config]
print(" ".join(managed))
PY
)

STRIP=0
if [ -n "$STALE" ]; then
  say ""
  say "Your config still sets: $STALE"
  say "The plugin manages these now, and your own values take precedence — stale model ids stay in the picker."
  if ask "Remove them (a backup is kept)?"; then STRIP=1; else say "Leaving them; remove them by hand later if the model list looks wrong."; fi
fi

python3 - "$CONFIG" "$PLUGIN" "$STRIP" <<'PY'
import json, shutil, sys, time

path, plugin, strip = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
try:
    config = json.load(open(path))
except Exception:
    config = {}

if config:
    shutil.copyfile(path, f"{path}.bak-{time.strftime('%Y%m%d%H%M%S')}")

config.setdefault("$schema", "https://opencode.ai/config.json")
plugins = [p for p in config.get("plugin", []) if "opencode-litellm-headers" not in str(p)]
config["plugin"] = plugins + [plugin]

if strip:
    for key in ("provider", "model", "small_model", "mcp"):
        config.pop(key, None)

json.dump(config, open(path, "w"), indent=2)
open(path, "a").write("\n")
PY
say "Wrote $CONFIG"

# 3. first launch: install the plugin, fetch the model list
say ""
say "Setting up (first run downloads the plugin and syncs models)..."
COUNT=$(opencode models --provider litellm 2>/dev/null | grep -c . || true)

say ""
if [ "$COUNT" -gt 0 ]; then
  say "Done — $COUNT models available. Start with: opencode"
else
  say "Setup finished, but no models came back."
  say "Check your LiteLLM key is in 1Password as: op://Employee/ai.apro.is litellm/API Key"
  say "Then run: op signin --account aproorg.1password.eu && opencode models --provider litellm"
  exit 1
fi
