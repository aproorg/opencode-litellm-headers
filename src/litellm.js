import { isFresh, readCache, writeCache } from "./cache.js"

const TTL_MS = 6 * 60 * 60 * 1000
const FALLBACK_TTL_MS = 10 * 60 * 1000
const TIMEOUT_MS = 8000

function cacheName(baseURL) {
  return `models-${Buffer.from(baseURL).toString("base64url")}.json`
}

function rootOf(baseURL) {
  return String(baseURL).replace(/\/+$/, "").replace(/\/v1$/, "")
}

async function getJson(url, apiKey, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      signal: controller.signal,
    })
    if (!response.ok) {
      // The body is the whole point: "budget exceeded" and "rate limit" are both 429.
      const body = await response.text().catch(() => "")
      const detail = body.trim().replace(/\s+/g, " ").slice(0, 400)
      throw new Error(`HTTP ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function modalities(supportsVision) {
  return { input: supportsVision ? ["text", "image"] : ["text"], output: ["text"] }
}

// /model_group/info: full metadata (limits, cost, capabilities).
// Only a declared non-chat mode excludes a model: embeddings, rerank, OCR and
// image/video models say what they are, while chat models may declare nothing.
function fromGroupInfo(body) {
  const groups = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
  const models = {}

  for (const group of groups) {
    const id = typeof group?.model_group === "string" ? group.model_group.trim() : ""
    if (!id || (group.mode && group.mode !== "chat")) continue

    const entry = {
      name: id,
      reasoning: group.supports_reasoning === true,
      attachment: group.supports_vision === true,
      tool_call: group.supports_function_calling !== false,
      temperature: Array.isArray(group.supported_openai_params)
        ? group.supported_openai_params.includes("temperature")
        : true,
      modalities: modalities(group.supports_vision === true),
      limit: {
        context: positive(group.max_input_tokens) ?? 0,
        output: positive(group.max_output_tokens) ?? 0,
      },
    }

    // The picker's effort options: opencode hardcodes low/medium/high for
    // openai-compatible providers unless the model declares its own.
    const efforts = Array.isArray(group.supported_reasoning_efforts) ? group.supported_reasoning_efforts : []
    if (efforts.length) {
      entry.variants = Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
    }

    const input = positive(group.input_cost_per_token)
    const output = positive(group.output_cost_per_token)
    if (input || output) entry.cost = { input: (input ?? 0) * 1e6, output: (output ?? 0) * 1e6 }

    models[id] = entry
  }

  return models
}

// /v1/models: id, mode and token limits only. Used when model_group/info is unavailable.
function fromModelList(body) {
  const items = Array.isArray(body?.data) ? body.data : []
  const models = {}

  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id.trim() : ""
    if (!id || (item.mode && item.mode !== "chat")) continue

    models[id] = {
      name: id,
      tool_call: true,
      temperature: true,
      modalities: modalities(false),
      limit: {
        context: positive(item.max_input_tokens) ?? 0,
        output: positive(item.max_output_tokens) ?? 0,
      },
    }
  }

  return models
}

function sorted(models) {
  return Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b)))
}

export async function discoverModels({ baseURL, apiKey, timeoutMs = TIMEOUT_MS, onWarning } = {}) {
  const name = cacheName(baseURL)
  const cached = await readCache(name)
  if (isFresh(cached, cached?.degraded ? FALLBACK_TTL_MS : TTL_MS) && Object.keys(cached.models ?? {}).length) {
    return cached.models
  }

  const root = rootOf(baseURL)
  let models = {}
  let degraded = false

  try {
    models = fromGroupInfo(await getJson(`${root}/model_group/info`, apiKey, timeoutMs))
  } catch (error) {
    onWarning?.("model_group/info unavailable, falling back to /v1/models", { error: String(error) })
    degraded = true
    try {
      models = fromModelList(await getJson(`${root}/v1/models`, apiKey, timeoutMs))
    } catch (fallbackError) {
      onWarning?.("LiteLLM model discovery failed", { error: String(fallbackError) })
    }
  }

  if (!Object.keys(models).length) return cached?.models ?? {}

  // The fallback carries no cost or capability data: keep richer cached models rather than thin ones.
  if (degraded && !cached?.degraded && Object.keys(cached?.models ?? {}).length) {
    onWarning?.("keeping cached model metadata instead of the degraded fallback")
    return cached.models
  }

  models = sorted(models)
  await writeCache(name, { ts: Date.now(), models, degraded }, { mode: 0o644 })
  return models
}
