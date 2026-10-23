import { basename } from "node:path"
import { run } from "./exec.js"

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

// includeCwd: V1 runs one opencode process per project, so its cwd is the project.
// V2 serves every project from one background server, whose cwd says nothing.
export function createRepoResolver({ worktree, directory, includeCwd = true } = {}) {
  const cache = new Map()

  async function gitRepoForDir(cwd) {
    if (cache.has(cwd)) return cache.get(cwd) || null

    let parsed = null
    const result = await run("git", ["-C", cwd, "remote", "get-url", "origin"])
    if (result.exitCode === 0) parsed = parseOrgRepo(result.stdout.trim())

    cache.set(cwd, parsed)
    return parsed
  }

  return async function resolveRepoLabel() {
    const candidates = Array.from(
      new Set(
        [includeCwd ? process.cwd() : undefined, worktree, directory].filter(
          (c) => typeof c === "string" && c.length > 0,
        ),
      ),
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
