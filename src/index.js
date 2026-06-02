// Using raw js instead of ts because of a bug in opencode: Stripping types is currently unsupported for files under node_modules ... src/index.ts failed to load plugin

import { basename } from "node:path"

const DEFAULT_PROVIDER_ID = "litellm"
const DEFAULT_HEADER_NAME = "x-github-repo"

function parseOrgRepo(url) {
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

export default async ({ $, worktree, directory }) => {
  const providerId = process.env.OPENCODE_LITELLM_PROVIDER_ID || DEFAULT_PROVIDER_ID
  const headerName = process.env.OPENCODE_LITELLM_HEADER_NAME || DEFAULT_HEADER_NAME
  const repoCache = new Map()

  async function gitRepoForDir(cwd) {
    if (repoCache.has(cwd)) return repoCache.get(cwd) || null


    let parsed = null
    try {
      const result = await $`git -C ${cwd} remote get-url origin`.quiet().nothrow()
      if (result.exitCode === 0) parsed = parseOrgRepo(String(result.stdout).trim())
    } catch {
      // Fall through to the basename fallback below.
    }

    repoCache.set(cwd, parsed)
    return parsed
  }

  async function resolveRepoLabel() {
    const candidates = Array.from(
      new Set([process.cwd(), worktree, directory].filter((c) => typeof c === "string" && c.length > 0)),
    )

    for (const cwd of candidates) {
      const repo = await gitRepoForDir(cwd)
      if (repo) return repo
    }

    for (const cwd of candidates) {
      const name = basename(cwd)
      if (name) return name
    }

    return "unknown"
  }

  return {
    "chat.headers": async (input, output) => {
      if (input.provider.id !== providerId) return
      const value = await resolveRepoLabel()
      if (value) output.headers[headerName] = value
    },
  }
}
