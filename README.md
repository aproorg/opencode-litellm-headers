# opencode-litellm-headers

OpenCode plugin that configures Apró's LiteLLM gateway for you: it fetches your API key from 1Password, declares the providers, syncs the live model list, and injects the mandatory `x-github-repo` header on every request.

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

It installs OpenCode if missing — or upgrades it if it predates 1.18.0, which is where the plugin config hook this relies on arrived — downloads the plugin to `~/.local/share/apro-opencode/`, records the version in a `VERSION` file beside it, points `~/.config/opencode/opencode.json` at it, offers to remove settings the plugin now manages (keeping a backup), and verifies by listing the models.

It asks which 1Password item holds your LiteLLM key, since it is not in the same vault for everyone. Press enter to accept the default, or paste the reference straight from 1Password's **Copy Secret Reference** button. Your answer is stored in `~/.config/opencode-apro/local.env` (`%APPDATA%\opencode-apro\local.env` on Windows) and becomes the default next time, so updating never re-asks blind.

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
| API key | `op read` against the reference you chose at install (default `op://Employee/ai.apro.is litellm/API Key`), cached 12h in `~/.cache/opencode-apro/secrets.json` (mode 0600) |
| Provider | `litellm` plus `litellm-anthropic`, `litellm-google`, `litellm-openai` → `@ai-sdk/openai-compatible` against `https://litellm.ai.apro.is/v1` |
| Models | `GET /model_group/info`, minus anything declaring a non-chat mode, with context/output limits, per-million costs and capabilities. Cached 6h |
| Reasoning effort | Each model's effort options come from the gateway's `supported_reasoning_efforts`, instead of OpenCode's hardcoded low/medium/high |
| Grouping | `claude-*` under **Anthropic**, `gemini-*` under **Google**, `gpt-*` under **OpenAI**, everything else under **LiteLLM** |
| Defaults | `model` and `small_model` set to the first available of a preferred list |
| Headers | `x-github-repo: <org>/<repo>`, resolved per request from the active directory's git remote |
| Other providers | `enabled_providers` is set to the four above, so only gateway models exist. Any provider key in your environment — `OPENAI_API_KEY`, `MISTRAL_API_KEY` — otherwise activates OpenCode's own provider for it, whose models bypass LiteLLM. Set `enabled_providers` yourself to override |

Anything you define yourself wins: the plugin only fills in keys that are absent, so a model or provider option in your own `opencode.json` is never overwritten.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `LITELLM_API_KEY` | — | Use this key instead of reading 1Password |
| `OPENCODE_LITELLM_OP_REF` | from `local.env` | 1Password reference to read the key from |
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
opencode models          # the live chat models across all four providers
```

Avoid `opencode debug config` for this: it dumps the fully resolved config, including the API key, with no redaction — don't paste its output into Slack or an issue.

To force a refresh of the model list or the cached key:

```bash
rm -rf ~/.cache/opencode-apro
```

## Migrating from the wrapper

The installer handles it: it replaces any earlier plugin entry, offers to remove the `provider`, `model`, `small_model` and `mcp` blocks the plugin now manages, and keeps a timestamped backup of your config. Stale model ids left in that file keep showing in the picker, because your own config takes precedence.

One thing it does not touch: delete `~/bin/opencode` yourself if you still have the wrapper that exported `LITELLM_API_KEY` and `OPENCODE_GITHUB_REPO`.

## How it works

OpenCode's config file is static JSON: it can substitute `{env:VAR}` but cannot run a command, which is why the setup used to need a shell wrapper to export secrets first. A plugin is code, and OpenCode runs the `config` hook on the loaded config before it builds providers and MCP servers — so the plugin does that work in-process instead.

The `x-github-repo` header goes through the `chat.headers` hook, which fires before every AI request. `provider.options.headers` with `{env:VAR}` resolves once at startup and freezes for the life of the process; the hook re-resolves per request, so the header follows you when you `cd` between repos. It filters on `input.provider.id`, so other providers are untouched, and falls back to the directory basename when there is no git remote.

## Development

```bash
git clone https://github.com/aproorg/opencode-litellm-headers.git
cd opencode-litellm-headers
```

Test against an isolated config without touching your own. Isolate with `HOME`, not `OPENCODE_CONFIG_DIR` — that one adds a config directory rather than replacing the real one, and other tooling sets it:

```bash
mkdir -p /tmp/octest/.config/opencode
printf '{"$schema":"https://opencode.ai/config.json","plugin":["file://%s/src/index.js"]}\n' "$PWD" \
  > /tmp/octest/.config/opencode/opencode.json
HOME=/tmp/octest LITELLM_API_KEY=... opencode models
```

Plain JavaScript, no build step.

## Prior art

The `config` + `provider.models` approach to model discovery follows [yuyu1025/opencode-plugin-litellm](https://github.com/yuyu1025/opencode-plugin-litellm) (MIT). This plugin is an independent implementation: it reads `/model_group/info` for cost and capability metadata, filters non-chat models, and adds 1Password and header handling.

## License

MIT
