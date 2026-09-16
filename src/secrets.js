import { isFresh, readCache, writeCache } from "./cache.js"
import { OP_ACCOUNT } from "./defaults.js"

const CACHE_FILE = "secrets.json"
const TTL_MS = 12 * 60 * 60 * 1000

export function createSecretReader($, { onWarning } = {}) {
  let loading
  let cache
  let dirty = false

  function load() {
    if (!loading) {
      loading = readCache(CACHE_FILE).then((entries) => {
        cache = entries ?? {}
        return cache
      })
    }
    return loading
  }

  async function read(ref, { required = false } = {}) {
    const entries = await load()
    const entry = entries[ref]
    if (isFresh(entry, TTL_MS) && entry.value) return entry.value

    let value
    try {
      const result = await $`op --account ${OP_ACCOUNT} read ${ref}`.quiet().nothrow()
      if (result.exitCode === 0) value = String(result.stdout).trim()
      else onWarning?.(`1Password read failed for ${ref}`, { stderr: String(result.stderr).trim().slice(0, 200) })
    } catch (error) {
      onWarning?.(`1Password CLI unavailable for ${ref}`, { error: String(error) })
    }

    if (!value) {
      if (entry?.value) return entry.value
      if (required) onWarning?.(`No value for ${ref}; run: op signin --account ${OP_ACCOUNT}`)
      return undefined
    }

    entries[ref] = { value, ts: Date.now() }
    dirty = true
    return value
  }

  async function flush() {
    if (dirty) await writeCache(CACHE_FILE, cache)
    dirty = false
  }

  return { read, flush }
}
