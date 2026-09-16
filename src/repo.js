import { basename } from "node:path"

export function parseOrgRepo(url) {
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

export function createRepoResolver($, { worktree, directory } = {}) {
  const cache = new Map()

  async function gitRepoForDir(cwd) {
    if (cache.has(cwd)) return cache.get(cwd) || null

    let parsed = null
    try {
      const result = await $`git -C ${cwd} remote get-url origin`.quiet().nothrow()
      if (result.exitCode === 0) parsed = parseOrgRepo(String(result.stdout).trim())
    } catch {
      // Fall through to the basename fallback below.
    }

    cache.set(cwd, parsed)
    return parsed
  }

  return async function resolveRepoLabel() {
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
}
