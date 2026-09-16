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

export function defaultMcp({ githubPat, home }) {
  const mcp = {
    memory: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-memory"] },
    sequentialthinking: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"] },
    filesystem: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", home] },
    fetch: { type: "local", command: ["uvx", "mcp-server-fetch"] },
    time: { type: "local", command: ["uvx", "mcp-server-time"] },
    git: { type: "local", command: ["uvx", "mcp-server-git"] },
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
