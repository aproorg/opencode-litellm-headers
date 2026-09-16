// Using raw js instead of ts because of a bug in opencode: Stripping types is currently unsupported for files under node_modules ... src/index.ts failed to load plugin

import os from "node:os"

import {
  BASE_URL,
  HEADER_NAME,
  OP_API_KEY_REF,
  OP_GITHUB_PAT_REF,
  PREFERRED_MODELS,
  PREFERRED_SMALL_MODELS,
  PROVIDER_ID,
  PROVIDER_NAME,
  PROVIDER_NPM,
  defaultMcp,
  resolveRunners,
} from "./defaults.js"
import { discoverModels } from "./litellm.js"
import { createRepoResolver } from "./repo.js"
import { createSecretReader } from "./secrets.js"

function envValue(name) {
  const value = process.env[name]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

function whichCommand(name) {
  try {
    return typeof Bun !== "undefined" && typeof Bun.which === "function" ? Bun.which(name) : name
  } catch {
    return undefined
  }
}

function firstAvailable(ids, models, providerId) {
  const id = ids.find((candidate) => models[candidate])
  return id ? `${providerId}/${id}` : undefined
}

export default async ({ $, client, worktree, directory }) => {
  const providerId = envValue("OPENCODE_LITELLM_PROVIDER_ID") ?? PROVIDER_ID
  const headerName = envValue("OPENCODE_LITELLM_HEADER_NAME") ?? HEADER_NAME
  const baseURL = envValue("OPENCODE_LITELLM_BASE_URL") ?? envValue("LITELLM_BASE_URL") ?? BASE_URL
  const manageMcp = process.env.OPENCODE_LITELLM_MCP !== "0"

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
      const wantsPat = manageMcp && !envValue("GITHUB_PERSONAL_ACCESS_TOKEN")
      const [apiKey, githubPat] = await Promise.all([
        envValue("LITELLM_API_KEY") ?? secrets.read(OP_API_KEY_REF, { required: true }),
        wantsPat ? secrets.read(OP_GITHUB_PAT_REF) : envValue("GITHUB_PERSONAL_ACCESS_TOKEN"),
      ])
      await secrets.flush()

      config.provider ??= {}
      const provider = (config.provider[providerId] ??= {})
      provider.name ??= PROVIDER_NAME
      provider.npm ??= PROVIDER_NPM
      provider.env ??= ["LITELLM_API_KEY"]
      provider.options ??= {}
      provider.options.baseURL ??= baseURL
      if (apiKey && provider.options.apiKey === undefined) provider.options.apiKey = apiKey

      const discovered = await discoverModels({ baseURL: provider.options.baseURL, apiKey, onWarning: warn })
      provider.models ??= {}
      for (const [id, model] of Object.entries(discovered)) provider.models[id] ??= model

      const count = Object.keys(discovered).length
      if (count) await log("info", `Synced ${count} LiteLLM chat models.`, { provider: providerId })
      else await warn("No LiteLLM models discovered; keeping configured models.", { provider: providerId })

      config.model ??= firstAvailable(PREFERRED_MODELS, provider.models, providerId)
      config.small_model ??= firstAvailable(PREFERRED_SMALL_MODELS, provider.models, providerId)

      if (manageMcp) {
        const runners = resolveRunners(whichCommand)
        config.mcp ??= {}
        for (const [name, server] of Object.entries(defaultMcp({ githubPat, home: os.homedir(), runners }))) {
          config.mcp[name] ??= server
        }
      }
    },

    "chat.headers": async (input, output) => {
      if (input.provider.id !== providerId) return
      const value = await resolveRepoLabel()
      if (value) output.headers[headerName] = value
    },
  }
}
