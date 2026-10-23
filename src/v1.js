// opencode V1 plugin API (1.18.29+ through 1.x). Unchanged behaviour; only the
// shell calls moved to node:child_process so V1 and V2 share the helpers.

import { MODEL_GROUPS, PREFERRED_MODELS, PREFERRED_SMALL_MODELS, PROVIDER_NAME, PROVIDER_NPM } from "./defaults.js"
import { apiKeyRef, firstAvailable, gatewayOptions, groupFor } from "./common.js"
import { discoverModels } from "./litellm.js"
import { createRepoResolver } from "./repo.js"
import { createSecretReader } from "./secrets.js"

function modelRef(ref) {
  return ref ? `${ref.providerID}/${ref.modelID}` : undefined
}

export async function server({ client, worktree, directory }) {
  const { providerId, headerName, baseURL, ourProviderIds } = gatewayOptions()

  const resolveRepoLabel = createRepoResolver({ worktree, directory })

  async function log(level, message, extra = {}) {
    try {
      await client?.app?.log?.({ body: { service: "opencode-litellm-headers", level, message, extra } })
    } catch {
      // Logging must never affect opencode startup.
    }
  }

  const warn = (message, extra) => log("warn", message, extra)
  const secrets = createSecretReader({ onWarning: warn })

  return {
    async config(config) {
      // 1Password is the only source. A stale LITELLM_API_KEY left in a shell profile
      // by the old wrapper otherwise replaces the real key and every request 401s.
      const apiKey = await secrets.read(await apiKeyRef(), { required: true })
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

      config.model ??= modelRef(firstAvailable(PREFERRED_MODELS, placed))
      config.small_model ??= modelRef(firstAvailable(PREFERRED_SMALL_MODELS, placed))
    },

    "chat.headers": async (input, output) => {
      if (!ourProviderIds.has(input.provider.id)) return
      const value = await resolveRepoLabel()
      if (value) output.headers[headerName] = value
    },
  }
}
