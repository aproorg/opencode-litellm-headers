// Using raw js instead of ts because of a bug in opencode: Stripping types is currently unsupported for files under node_modules ... src/index.ts failed to load plugin

import {
  BASE_URL,
  HEADER_NAME,
  MODEL_GROUPS,
  OP_API_KEY_REF,
  PREFERRED_MODELS,
  PREFERRED_SMALL_MODELS,
  PROVIDER_ID,
  PROVIDER_NAME,
  PROVIDER_NPM,
} from "./defaults.js"
import { discoverModels } from "./litellm.js"
import { createRepoResolver } from "./repo.js"
import { createSecretReader } from "./secrets.js"
import { readSettings } from "./settings.js"

function envValue(name) {
  const value = process.env[name]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

function groupFor(modelId, baseId) {
  const group = MODEL_GROUPS.find(({ prefix }) => modelId.startsWith(prefix))
  return group ? `${baseId}-${group.suffix}` : baseId
}

function firstAvailable(ids, placed) {
  const id = ids.find((candidate) => placed[candidate])
  return id ? `${placed[id]}/${id}` : undefined
}

export default async ({ $, client, worktree, directory }) => {
  const providerId = envValue("OPENCODE_LITELLM_PROVIDER_ID") ?? PROVIDER_ID
  const headerName = envValue("OPENCODE_LITELLM_HEADER_NAME") ?? HEADER_NAME
  const baseURL = envValue("OPENCODE_LITELLM_BASE_URL") ?? envValue("LITELLM_BASE_URL") ?? BASE_URL

  const ourProviderIds = new Set([providerId, ...MODEL_GROUPS.map(({ suffix }) => `${providerId}-${suffix}`)])

  const resolveRepoLabel = createRepoResolver($, { worktree, directory })

  async function log(level, message, extra = {}) {
    try {
      await client?.app?.log?.({ body: { service: "opencode-litellm-headers", level, message, extra } })
    } catch {
      // Logging must never affect opencode startup.
    }
  }

  const warn = (message, extra) => log("warn", message, extra)
  const secrets = createSecretReader($, { onWarning: warn })

  return {
    async config(config) {
      const settings = await readSettings()
      const keyRef = envValue("OPENCODE_LITELLM_OP_REF") ?? settings.OP_API_KEY_REF ?? OP_API_KEY_REF
      // 1Password is the only source. A stale LITELLM_API_KEY left in a shell profile
      // by the old wrapper otherwise replaces the real key and every request 401s.
      const apiKey = await secrets.read(keyRef, { required: true })
      await secrets.flush()

      config.provider ??= {}

      function ensureProvider(id, name) {
        const provider = (config.provider[id] ??= {})
        provider.name ??= name
        provider.npm ??= PROVIDER_NPM
        provider.options ??= {}
        provider.options.baseURL ??= baseURL
        if (apiKey && provider.options.apiKey === undefined) provider.options.apiKey = apiKey
        provider.models ??= {}
        return provider
      }

      const root = ensureProvider(providerId, PROVIDER_NAME)
      const discovered = await discoverModels({ baseURL: root.options.baseURL, apiKey, onWarning: warn })

      const placed = {}
      for (const [id, model] of Object.entries(discovered)) {
        const target = groupFor(id, providerId)
        const group = MODEL_GROUPS.find(({ suffix }) => target === `${providerId}-${suffix}`)
        const provider = target === providerId ? root : ensureProvider(target, group.name)
        provider.models[id] ??= model
        placed[id] = target
      }

      const count = Object.keys(discovered).length
      if (count) await log("info", `Synced ${count} LiteLLM chat models.`, { provider: providerId })
      else await warn("No LiteLLM models discovered; keeping configured models.", { provider: providerId })

      // Only the gateway: any provider key in the environment otherwise activates
      // opencode's own provider for it, whose models bypass LiteLLM entirely.
      config.enabled_providers ??= [...ourProviderIds]
      config.disabled_providers ??= ["opencode"]

      config.model ??= firstAvailable(PREFERRED_MODELS, placed)
      config.small_model ??= firstAvailable(PREFERRED_SMALL_MODELS, placed)

    },

    "chat.headers": async (input, output) => {
      if (!ourProviderIds.has(input.provider.id)) return
      const value = await resolveRepoLabel()
      if (value) output.headers[headerName] = value
    },
  }
}
