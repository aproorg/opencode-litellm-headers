// opencode V2 plugin API (2.x). Same behaviour as v1.js, mapped onto V2's domains:
//
//   V1 config hook          -> ctx.provider.transform (providers + models)
//                              ctx.model.transform    (default model)
//   V1 enabled_providers    -> provider transform removes non-gateway providers
//   V1 chat.headers         -> ctx.session.hook("model.request")
//
// Transform callbacks must be synchronous, so they read the key and model list
// from `state`. And V2 fails the whole session with "Location plugins did not
// finish activating" when setup() runs past a few seconds, so setup() starts
// from the caches and waits at most SETUP_BUDGET_MS for 1Password and the
// gateway. A slower answer still lands: it refreshes the caches and reloads.

import { PREFERRED_MODELS, PROVIDER_NAME } from "./defaults.js"
import { apiKeyRef, envValue, firstAvailable, gatewayOptions, groupFor, groupName } from "./common.js"
import { discoverModels, peekModels } from "./litellm.js"
import { createRepoResolver } from "./repo.js"
import { createSecretReader } from "./secrets.js"

const V2_PACKAGE = "@opencode/ai/providers/openai-compatible"
const SETUP_BUDGET_MS = 3500

// opencode's own free models proxy through opencode.ai, bypassing the gateway.
const ALWAYS_BLOCKED = new Set(["opencode"])

function warn(message, extra) {
  console.warn(`[opencode-litellm-headers] ${message}`, extra ?? "")
}

// v1.js and litellm.js speak the V1 model shape; V2 wants Model.Info.
export function toModelInfo(providerID, id, model) {
  const cost = model.cost
    ? [{ input: model.cost.input ?? 0, output: model.cost.output ?? 0, cache: { read: 0, write: 0 } }]
    : []
  const variants = Object.entries(model.variants ?? {}).map(([variant, settings]) => ({ id: variant, settings }))

  return {
    id,
    modelID: id,
    providerID,
    name: model.name ?? id,
    capabilities: {
      tools: model.tool_call !== false,
      input: model.modalities?.input ?? ["text"],
      output: model.modalities?.output ?? ["text"],
      ...(typeof model.temperature === "boolean" ? { temperature: model.temperature } : {}),
    },
    variants,
    time: { released: 0 },
    cost,
    status: "active",
    enabled: true,
    limit: { context: model.limit?.context ?? 0, output: model.limit?.output ?? 0 },
  }
}

export async function setup(ctx) {
  const { providerId, headerName, baseURL, ourProviderIds } = gatewayOptions()
  const extraProviders = new Set(
    (envValue("OPENCODE_LITELLM_EXTRA_PROVIDERS") ?? "").split(",").map((id) => id.trim()).filter(Boolean),
  )

  const secrets = createSecretReader({ onWarning: warn })
  const ref = await apiKeyRef()
  const state = { apiKey: await secrets.peek(ref), models: await peekModels(baseURL) }

  // Both calls answer from their own caches while those are fresh, so this is
  // only slow on a cold or expired cache.
  const refresh = (async () => {
    const apiKey = await secrets.read(ref, { required: true })
    await secrets.flush()
    const models = await discoverModels({ baseURL, apiKey: apiKey ?? state.apiKey, onWarning: warn })
    if (!Object.keys(models).length) warn("No LiteLLM models discovered; keeping configured models.")
    return { apiKey: apiKey ?? state.apiKey, models: Object.keys(models).length ? models : state.models }
  })().catch((error) => {
    warn("refreshing the key and models failed", { error: String(error) })
    return undefined
  })

  let timer
  const budget = new Promise((resolve) => {
    timer = setTimeout(resolve, SETUP_BUDGET_MS, "late")
  })
  const first = await Promise.race([refresh, budget])
  clearTimeout(timer)

  if (first === "late") {
    warn(`1Password or the gateway took over ${SETUP_BUDGET_MS}ms; starting from cache and reloading when they answer.`)
    refresh.then(async (late) => {
      if (!late) return
      Object.assign(state, late)
      try {
        await ctx.provider.reload()
        await ctx.model.reload()
      } catch (error) {
        warn("reload after a late refresh failed; restart opencode to pick up the key and models", { error: String(error) })
      }
    })
  } else if (first) {
    Object.assign(state, first)
  }

  // Grouped from `state` at call time, so a reload after a late refresh sees it.
  function grouped() {
    const byProvider = new Map([[providerId, []]])
    const placed = {}
    for (const [id, model] of Object.entries(state.models)) {
      const target = groupFor(id, providerId)
      if (!byProvider.has(target)) byProvider.set(target, [])
      byProvider.get(target).push(toModelInfo(target, id, model))
      placed[id] = target
    }
    return { byProvider, placed }
  }

  await ctx.provider.transform((editor) => {
    const { apiKey } = state
    for (const [id, models] of grouped().byProvider) {
      const existing = editor.get(id)
      if (!existing) {
        editor.add({
          info: {
            id,
            name: groupName(providerId, id) ?? PROVIDER_NAME,
            activation: "enabled",
            package: V2_PACKAGE,
            settings: { baseURL, ...(apiKey ? { apiKey } : {}) },
          },
          models,
        })
        continue
      }

      // Anything the user defined wins: only fill what is absent.
      editor.update(id, (provider) => {
        provider.settings ??= {}
        provider.settings.baseURL ??= baseURL
        if (apiKey && provider.settings.apiKey === undefined) provider.settings.apiKey = apiKey
      })
      const merged = new Map(existing.models)
      for (const model of models) if (!merged.has(model.id)) merged.set(model.id, model)
      editor.models.set(id, [...merged.values()])
    }

    // Only the gateway: an env key such as OPENAI_API_KEY otherwise activates
    // opencode's own provider for it, whose models bypass LiteLLM entirely.
    // Providers the user configured explicitly stay; OPENCODE_LITELLM_EXTRA_PROVIDERS
    // keeps any other by id.
    for (const record of editor.list()) {
      const id = record.provider.id
      if (ourProviderIds.has(id) || extraProviders.has(id)) continue
      if (ALWAYS_BLOCKED.has(id) || record.provider.activation !== "enabled") editor.remove(id)
    }
  })

  await ctx.model.transform((editor) => {
    const preferred = firstAvailable(PREFERRED_MODELS, grouped().placed)
    if (preferred && !editor.default.get()) editor.default.set(preferred.providerID, preferred.modelID)
  })

  // The plugin instance belongs to one location; the server's own cwd is meaningless.
  const resolveRepoLabel = createRepoResolver({
    directory: ctx.location?.directory,
    worktree: ctx.location?.project?.directory,
    includeCwd: false,
  })

  await ctx.session.hook("model.request", async (event) => {
    if (!ourProviderIds.has(event.model?.providerID)) return
    const value = await resolveRepoLabel()
    if (value) event.headers[headerName] = value
  })
}
