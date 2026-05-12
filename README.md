# opencode-litellm-headers

OpenCode plugin that injects an `x-github-repo` header into LiteLLM AI requests for per-repository usage attribution. Drop-in replacement for the `ANTHROPIC_CUSTOM_HEADERS` env-var trick used with Claude Code.

## Why this plugin

OpenCode's `provider.options.headers` field supports `{env:VARNAME}` substitution, but it resolves once at process startup. The value freezes at boot and does not follow `cd` between repos within a session. The `shell.env` plugin hook only injects variables into shell commands the agent runs — it does not reach OpenCode's own AI requests. Custom proxies are unnecessary complexity.

OpenCode 1.4+ exposes a dedicated `chat.headers` plugin hook that fires before every AI request. This plugin uses that hook to:

- Detect the active git repository per-request via `git remote get-url origin`
- Filter on a configurable provider ID (default: `litellm`) so other providers are untouched
- Cache lookups per working directory
- Fall back to the directory basename if no git remote is found

## Install

In your `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "@aproorg/opencode-litellm-headers@git+https://github.com/aproorg/opencode-litellm-headers.git"
  ]
}
```

Restart OpenCode. It will run `bun install` automatically and load the plugin.

## Configuration

The plugin reads two optional environment variables:

| Variable                          | Default          | Purpose                                                              |
| --------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `OPENCODE_LITELLM_PROVIDER_ID`    | `litellm`        | Provider ID to match. Must equal the key used in your `provider` config. |
| `OPENCODE_LITELLM_HEADER_NAME`    | `x-github-repo`  | Outgoing header name.                                                |

If your `opencode.json` defines the LiteLLM provider under a different key (say `"my-gateway"`), export `OPENCODE_LITELLM_PROVIDER_ID=my-gateway` before launching OpenCode.

## Verify

Send a trivial prompt in a known repo and check your LiteLLM logs for the inbound request — you should see:

```
x-github-repo: your-org/your-repo
```

## How it works

1. Plugin loads at startup from your `opencode.json` `plugin` array.
2. On every AI request, the `chat.headers` hook fires.
3. Plugin checks `input.provider.id` against the configured provider ID. Other providers (MCP servers, future additions) are skipped.
4. It runs `git -C <worktree> remote get-url origin`, parses the org/repo pair, and caches the result keyed on the working directory.
5. Sets `output.headers[headerName] = "<org>/<repo>"`.
6. If no git remote is found, falls back to the directory basename so the request is still attributed.

## Comparison with Claude Code

| Aspect              | Claude Code (`ANTHROPIC_CUSTOM_HEADERS`)    | OpenCode (this plugin)                            |
| ------------------- | ------------------------------------------- | ------------------------------------------------- |
| Mechanism           | Env var read by Claude Code at startup      | `chat.headers` plugin hook                        |
| Repo detected when  | Shell launch (frozen for process life)      | Per-request (tracks cwd changes)                  |
| Provider scope      | All Anthropic requests                      | Filtered to the configured provider only          |
| Fallback            | Empty header                                | Directory basename                                |

## Development

```bash
git clone https://github.com/aproorg/opencode-litellm-headers.git
cd opencode-litellm-headers
bun install
```

To test locally without publishing, place the plugin in your config directory:

```bash
ln -s "$(pwd)/src/index.ts" ~/.config/opencode/plugins/litellm-headers.ts
```

## License

MIT
