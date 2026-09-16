export const PROVIDER_ID = "litellm"
export const PROVIDER_NAME = "LiteLLM"
export const PROVIDER_NPM = "@ai-sdk/openai-compatible"
export const HEADER_NAME = "x-github-repo"

export const BASE_URL = "https://litellm.ai.apro.is/v1"

export const OP_ACCOUNT = "aproorg.1password.eu"
export const OP_API_KEY_REF = "op://Employee/ai.apro.is litellm/API Key"
export const OP_GITHUB_PAT_REF = "op://Employee/Claude Code Github PAT/PAT"

// First id present in the synced model list wins.
export const PREFERRED_MODELS = ["claude-opus-5", "claude-opus-4-8", "claude-sonnet-5"]
export const PREFERRED_SMALL_MODELS = ["claude-haiku-4-5", "gemini-3.8-flash"]

// npx/bunx and uvx are optional: servers whose runner is missing are skipped, not registered broken.
export function resolveRunners(which) {
  const js = which("npx") ? ["npx", "-y"] : which("bunx") ? ["bunx"] : undefined
  return { js, uvx: which("uvx") ? ["uvx"] : undefined }
}

export function defaultMcp({ githubPat, home, runners }) {
  const mcp = {}

  if (runners.js) {
    mcp.memory = { type: "local", command: [...runners.js, "@modelcontextprotocol/server-memory"] }
    mcp.sequentialthinking = { type: "local", command: [...runners.js, "@modelcontextprotocol/server-sequential-thinking"] }
    mcp.filesystem = { type: "local", command: [...runners.js, "@modelcontextprotocol/server-filesystem", home] }
  }

  if (runners.uvx) {
    mcp.fetch = { type: "local", command: [...runners.uvx, "mcp-server-fetch"] }
    mcp.time = { type: "local", command: [...runners.uvx, "mcp-server-time"] }
    mcp.git = { type: "local", command: [...runners.uvx, "mcp-server-git"] }
  }

  if (githubPat) {
    mcp.github = {
      type: "remote",
      url: "https://api.githubcopilot.com/mcp/",
      oauth: false,
      headers: { Authorization: `Bearer ${githubPat}` },
    }
  }

  return mcp
}
