# opencode-litellm-headers

OpenCode plugin that configures Apró's LiteLLM gateway for you: it fetches your API key from 1Password, declares the provider, syncs the live model list, registers the shared MCP servers, and injects the mandatory `x-github-repo` header on every request.

It replaces the hand-copied `~/bin/opencode` wrapper and the hand-maintained model list in `opencode.json`.

## Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/aproorg/opencode-litellm-headers/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/aproorg/opencode-litellm-headers/main/install.ps1 | iex
```

**Run the same command again to update.** The installer owns the plugin files, so rerunning replaces them with the current version — there is no package cache to invalidate.

It installs OpenCode if missing, downloads the plugin to `~/.local/share/apro-opencode/`, records the version in a `VERSION` file beside it, points `~/.config/opencode/opencode.json` at it, offers to remove settings the plugin now manages (keeping a backup), and verifies by listing the models.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENCODE_LITELLM_REF` | `main` | Branch, tag or commit to install — use it to pin or roll back |
| `OPENCODE_LITELLM_HOME` | `~/.local/share/apro-opencode` | Where the plugin files live |
| `OPENCODE_ASSUME_YES` | unset | `1` answers every prompt with yes |

The config it writes is one entry:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///Users/you/.local/share/apro-opencode/index.js"]
}
```

## What the plugin sets up

| Area | Behaviour |
| --- | --- |
| API key | `op read "op://Employee/ai.apro.is litellm/API Key"`, cached 12h in `~/.cache/opencode-apro/secrets.json` (mode 0600) |
| Provider | `litellm` plus `litellm-anthropic`, `litellm-google`, `litellm-openai` → `@ai-sdk/openai-compatible` against `https://litellm.ai.apro.is/v1` |
| Models | `GET /model_group/info`, minus anything declaring a non-chat mode, with context/output limits, per-million costs and capabilities. Cached 6h |
| Reasoning effort | Each model's effort options come from the gateway's `supported_reasoning_efforts`, instead of OpenCode's hardcoded low/medium/high |
| Grouping | `claude-*` under **Anthropic**, `gemini-*` under **Google**, `gpt-*` under **OpenAI**, everything else under **LiteLLM** |
| Defaults | `model` and `small_model` set to the first available of a preferred list |
| Headers | `x-github-repo: <org>/<repo>`, resolved per request from the active directory's git remote |
| OpenCode Zen | Disabled, since its models are not served by the gateway. Set `disabled_providers` yourself to keep it |

Anything you define yourself wins: the plugin only fills in keys that are absent, so a model, MCP server or provider option in your own `opencode.json` is never overwritten.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `LITELLM_API_KEY` | — | Use this key instead of reading 1Password |
| `OPENCODE_LITELLM_BASE_URL` | `https://litellm.ai.apro.is/v1` | Gateway to talk to |
| `OPENCODE_LITELLM_PROVIDER_ID` | `litellm` | Provider key in your config |
| `OPENCODE_LITELLM_HEADER_NAME` | `x-github-repo` | Outgoing header name |

## MCP servers

The plugin registers none. Add the ones you want:

```bash
opencode mcp add
```

## Verify

```bash
opencode models --provider litellm   # the live chat models, no hand-maintained list
```

Avoid `opencode debug config` for this: it dumps the fully resolved config, including the API key and the GitHub PAT, with no redaction — don't paste its output into Slack or an issue.

To force a refresh of the model list or the cached key:

```bash
rm -rf ~/.cache/opencode-apro
```

## Migrating from the wrapper

1. Delete `~/bin/opencode` (the wrapper that exported `LITELLM_API_KEY` and `OPENCODE_GITHUB_REPO`).
2. Remove the `provider`, `model`, `small_model` and `mcp` blocks from `~/.config/opencode/opencode.json`, leaving `$schema` and `plugin`. Stale model ids left in that file keep showing up in the picker, because your own config takes precedence.
3. Run `opencode` — the first launch pays ~5s for the 1Password read, later launches are warm.

## How it works

OpenCode's config file is static JSON: it can substitute `{env:VAR}` but cannot run a command, which is why the setup used to need a shell wrapper to export secrets first. A plugin is code, and OpenCode runs the `config` hook on the loaded config before it builds providers and MCP servers — so the plugin does that work in-process instead.

The `x-github-repo` header goes through the `chat.headers` hook, which fires before every AI request. `provider.options.headers` with `{env:VAR}` resolves once at startup and freezes for the life of the process; the hook re-resolves per request, so the header follows you when you `cd` between repos. It filters on `input.provider.id`, so other providers are untouched, and falls back to the directory basename when there is no git remote.

## Development

```bash
git clone https://github.com/aproorg/opencode-litellm-headers.git
cd opencode-litellm-headers
```

Test against an isolated config without touching your own:

```bash
mkdir -p /tmp/octest/opencode/plugin
echo '{"$schema":"https://opencode.ai/config.json"}' > /tmp/octest/opencode/opencode.json
echo 'export { default } from "'"$PWD"'/src/index.js"' > /tmp/octest/opencode/plugin/apro.js
HOME=/tmp/octest-home OPENCODE_CONFIG_DIR=/tmp/octest/opencode opencode models --provider litellm
```

Plain JavaScript, no build step: OpenCode cannot strip types from files under `node_modules`, so the sources stay `.js`.

## Prior art

The `config` + `provider.models` approach to model discovery follows [yuyu1025/opencode-plugin-litellm](https://github.com/yuyu1025/opencode-plugin-litellm) (MIT). This plugin is an independent implementation: it reads `/model_group/info` for cost and capability metadata, filters non-chat models, and adds 1Password, MCP and header handling.

## License

MIT
