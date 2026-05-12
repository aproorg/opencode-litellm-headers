import type { Plugin } from "@opencode-ai/plugin"
import { basename } from "node:path"

const DEFAULT_PROVIDER_ID = "litellm"
const DEFAULT_HEADER_NAME = "x-github-repo"

function parseOrgRepo(url: string): string | null {
  if (!url) return null
  let path = url.trim()
  if (path.includes("://")) {
    path = path.split("/").slice(3).join("/")
  } else if (path.includes(":")) {
    path = path.split(":").slice(1).join(":")
  }
  path = path.replace(/\.git$/, "").replace(/\/+$/, "")
  const parts = path.split("/").filter(Boolean)
  if (parts.length < 2) return null
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

export const LiteLLMGitHubRepoHeaderPlugin: Plugin = async ({
  $,
  worktree,
  directory,
}) => {
  const providerId =
    process.env.OPENCODE_LITELLM_PROVIDER_ID || DEFAULT_PROVIDER_ID
  const headerName =
    process.env.OPENCODE_LITELLM_HEADER_NAME || DEFAULT_HEADER_NAME

  const cache = new Map<string, string>()

  async function detectRepo(cwd: string): Promise<string> {
    const cached = cache.get(cwd)
    if (cached !== undefined) return cached

    let value = basename(cwd) || basename(process.cwd())
    try {
      const result = await $`git -C ${cwd} remote get-url origin`
        .quiet()
        .nothrow()
      if (result.exitCode === 0) {
        const url = String(result.stdout).trim()
        const parsed = parseOrgRepo(url)
        if (parsed) value = parsed
      }
    } catch {
      // fall through to basename fallback
    }

    cache.set(cwd, value)
    return value
  }

  return {
    "chat.headers": async (input, output) => {
      if (input.provider.id !== providerId) return
      const cwd = worktree || directory || process.cwd()
      const repo = await detectRepo(cwd)
      if (repo) output.headers[headerName] = repo
    },
  }
}

export default LiteLLMGitHubRepoHeaderPlugin
