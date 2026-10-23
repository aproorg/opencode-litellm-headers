import { BASE_URL, HEADER_NAME, MODEL_GROUPS, OP_API_KEY_REF, PROVIDER_ID } from "./defaults.js"
import { readSettings } from "./settings.js"

// Settings both plugin APIs share, so V1 and V2 never disagree about the gateway.

export function envValue(name) {
  const value = process.env[name]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

export function gatewayOptions() {
  const providerId = envValue("OPENCODE_LITELLM_PROVIDER_ID") ?? PROVIDER_ID
  return {
    providerId,
    headerName: envValue("OPENCODE_LITELLM_HEADER_NAME") ?? HEADER_NAME,
    baseURL: envValue("OPENCODE_LITELLM_BASE_URL") ?? envValue("LITELLM_BASE_URL") ?? BASE_URL,
    ourProviderIds: new Set([providerId, ...MODEL_GROUPS.map(({ suffix }) => `${providerId}-${suffix}`)]),
  }
}

export async function apiKeyRef() {
  const settings = await readSettings()
  return envValue("OPENCODE_LITELLM_OP_REF") ?? settings.OP_API_KEY_REF ?? OP_API_KEY_REF
}

export function groupFor(modelId, baseId) {
  const group = MODEL_GROUPS.find(({ prefix }) => modelId.startsWith(prefix))
  return group ? `${baseId}-${group.suffix}` : baseId
}

export function groupName(providerId, target) {
  return MODEL_GROUPS.find(({ suffix }) => target === `${providerId}-${suffix}`)?.name
}

export function firstAvailable(ids, placed) {
  const id = ids.find((candidate) => placed[candidate])
  return id ? { providerID: placed[id], modelID: id } : undefined
}
