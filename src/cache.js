import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const DIR = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "opencode-apro")

export function cachePath(name) {
  return path.join(DIR, name)
}

export async function readCache(name) {
  try {
    return JSON.parse(await fs.readFile(cachePath(name), "utf8"))
  } catch {
    return undefined
  }
}

export async function writeCache(name, data, { mode = 0o600 } = {}) {
  const file = cachePath(name)
  try {
    await fs.mkdir(DIR, { recursive: true, mode: 0o700 })
    await fs.writeFile(file, JSON.stringify(data), { mode })
    await fs.chmod(file, mode)
  } catch {
    // A cache that cannot be written is not fatal; the next launch refetches.
  }
}

export function isFresh(entry, ttlMs) {
  return typeof entry?.ts === "number" && Date.now() - entry.ts < ttlMs
}
