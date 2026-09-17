#!/usr/bin/env bash
set -euo pipefail

REPO="aproorg/opencode-litellm-headers"
REF="${OPENCODE_LITELLM_REF:-main}"
PLUGIN_HOME="${OPENCODE_LITELLM_HOME:-$HOME/.local/share/apro-opencode}"
CONFIG_DIR="${OPENCODE_LITELLM_CONFIG_DIR:-$HOME/.config/opencode}"
CONFIG="$CONFIG_DIR/opencode.json"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
APRO_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-apro"
LOCAL_ENV="$APRO_CONFIG_DIR/local.env"
OP_ACCOUNT="aproorg.1password.eu"
DEFAULT_OP_REF="op://Employee/ai.apro.is litellm/API Key"
# The config hook this plugin needs does not exist in older opencode.
MIN_OPENCODE="1.18.0"
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

# Prompts go through /dev/tty: under `curl | bash` stdin is the script itself.
prompt_default() {
  local question="$1" default="$2" reply=""
  if { exec 3<>/dev/tty; } 2>/dev/null; then
    printf '  %s [%s]: ' "$question" "$default" >&3
    IFS= read -r reply <&3 || reply=""
    exec 3<&-
  fi
  reply="${reply:-$default}"
  # 1Password's "Copy Secret Reference" hands you a quoted string.
  case "$reply" in
    \"*\" | \'*\') reply="${reply:1:${#reply}-2}" ;;
  esac
  printf '%s\n' "$reply"
}

read_existing() {
  [ -f "$LOCAL_ENV" ] || return 0
  sed -nE 's/^'"$1"'="(.*)"$/\1/p' "$LOCAL_ENV" | head -1
}

version_lt() {
  [ "$1" = "$2" ] && return 1
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]
}

opencode_version() { opencode --version 2>/dev/null | tr -d '\r' | head -1; }

# 1. opencode itself, new enough to have the plugin config hook
if ! command -v opencode >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 || fail "opencode is not installed and Homebrew is missing. See https://brew.sh then rerun."
  say "Installing opencode..."
  brew install anomalyco/tap/opencode
fi

OC_VERSION=$(opencode_version)
if [ -z "$OC_VERSION" ] || version_lt "${OC_VERSION%%-*}" "$MIN_OPENCODE"; then
  say "opencode ${OC_VERSION:-unknown} is too old for this plugin (needs $MIN_OPENCODE or newer). Upgrading..."
  if command -v brew >/dev/null 2>&1 && brew list anomalyco/tap/opencode >/dev/null 2>&1; then
    brew upgrade anomalyco/tap/opencode || true
  elif command -v npm >/dev/null 2>&1 && npm ls -g opencode-ai >/dev/null 2>&1; then
    npm install -g opencode-ai@latest
  elif command -v brew >/dev/null 2>&1; then
    brew install anomalyco/tap/opencode || true
  else
    fail "cannot upgrade opencode automatically — upgrade it yourself, then rerun."
  fi
  OC_VERSION=$(opencode_version)
  if [ -z "$OC_VERSION" ] || version_lt "${OC_VERSION%%-*}" "$MIN_OPENCODE"; then
    fail "opencode is still ${OC_VERSION:-unknown} after upgrading, and this plugin needs $MIN_OPENCODE or newer."
  fi
fi
say "opencode $OC_VERSION at $(command -v opencode)"

# 2. the plugin itself, as files we own — rerunning this script is the update path
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
say "Downloading plugin ($REF)..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xzf - -C "$TMP" || fail "could not download $REPO at $REF"
SRC=$(find "$TMP" -maxdepth 2 -type d -name src | head -1)
[ -n "$SRC" ] || fail "downloaded archive has no src directory"

SHA=$(curl -fsSL "https://api.github.com/repos/$REPO/commits/$REF" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"][:7])' 2>/dev/null || echo unknown)
mkdir -p "$(dirname "$PLUGIN_HOME")"
rm -rf "$PLUGIN_HOME"
mv "$SRC" "$PLUGIN_HOME"
printf '%s %s\n' "$REF" "$SHA" > "$PLUGIN_HOME/VERSION"
say "Installed plugin $REF ($SHA) to $PLUGIN_HOME"

# 3. which 1Password item holds the key — not everyone has it in the same vault
CURRENT_OP_REF=$(read_existing OP_API_KEY_REF)
# Stays fixed across retries: offering a rejected answer back as the default is maddening.
PROMPT_DEFAULT_REF="${CURRENT_OP_REF:-$DEFAULT_OP_REF}"
OP_REF="$PROMPT_DEFAULT_REF"
if [ "${OPENCODE_ASSUME_YES:-0}" != "1" ]; then
  say ""
  while :; do
    OP_REF=$(prompt_default "1Password secret reference (Copy Secret Reference in 1Password)" "$PROMPT_DEFAULT_REF")
    case "$OP_REF" in
      op://*) ;;
      *) say "  must start with op:// — try again"; continue ;;
    esac
    REST="${OP_REF#op://}"
    IFS='/' read -ra SEGS <<< "$REST"
    if [ "${#SEGS[@]}" -lt 3 ] || [ -z "${SEGS[0]:-}" ] || [ -z "${SEGS[1]:-}" ]; then
      say "  need a full reference like op://Vault/Item/Field — got '$OP_REF'"
      continue
    fi
    break
  done
fi

mkdir -p "$APRO_CONFIG_DIR"
TMP_ENV=$(mktemp)
[ -f "$LOCAL_ENV" ] && grep -v '^OP_API_KEY_REF=' "$LOCAL_ENV" > "$TMP_ENV" || true
printf 'OP_API_KEY_REF="%s"\n' "$OP_REF" >> "$TMP_ENV"
mv "$TMP_ENV" "$LOCAL_ENV"

# Not fatal: 1Password may simply not be signed in yet.
# stdin closed: op prompts to add an account when it has none, and would eat the terminal.
if command -v op >/dev/null 2>&1 && ! op --account "$OP_ACCOUNT" read "$OP_REF" >/dev/null 2>&1 </dev/null; then
  say "  note: could not read that item yet — check it if no models show up below"
fi

# 4. config
mkdir -p "$CONFIG_DIR"

# opencode.json is the file we manage; config.json and opencode.jsonc also load and would override it.
for other in "$CONFIG_DIR/opencode.jsonc" "$CONFIG_DIR/config.json"; do
  if [ -f "$other" ]; then
    mv "$other" "$other.bak-$TS"
    say "Moved $(basename "$other") aside — it overrides opencode.json. Old settings: $other.bak-$TS"
  fi
done

# Back up before touching anything, and never edit a file we cannot parse.
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

path, entry, strip = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
config = json.load(open(path))

config.setdefault("$schema", "https://opencode.ai/config.json")
plugins = [p for p in config.get("plugin", []) if "opencode-litellm-headers" not in str(p) and "apro-opencode" not in str(p)]
config["plugin"] = plugins + [entry]

if strip:
    for key in ("provider", "model", "small_model", "mcp"):
        config.pop(key, None)

json.dump(config, open(path, "w"), indent=2)
open(path, "a").write("\n")
' "$CONFIG" "file://$PLUGIN_HOME/index.js" "$STRIP"
say "Wrote $CONFIG"

# Earlier versions were installed as a package; leaving that cached would load the plugin twice.
rm -rf "$CACHE_HOME/opencode/packages/@aproorg"

# 5. verify
say ""
say "Syncing models..."
COUNT=$(opencode models 2>/dev/null | grep -cE "^litellm(/|-)" || true)

say ""
if [ "$COUNT" -gt 0 ]; then
  say "Done — $COUNT models available. Start with: opencode"
  say "Run this command again at any time to update."
else
  say "Setup finished, but no models came back."
  say "Check your LiteLLM key is in 1Password as: op://Employee/ai.apro.is litellm/API Key"
  say "Then run: op signin --account aproorg.1password.eu && opencode models"
  exit 1
fi
