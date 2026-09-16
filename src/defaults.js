export const PROVIDER_ID = "litellm"
export const PROVIDER_NAME = "LiteLLM"

// The picker groups by provider. Ids stay prefixed so they never collide with the
// models.dev entries for anthropic/google/openai, which would merge in models the
// gateway does not serve. Anything unmatched stays in the catch-all provider.
export const MODEL_GROUPS = [
  { suffix: "anthropic", name: "Anthropic", prefix: "claude-" },
  { suffix: "google", name: "Google", prefix: "gemini-" },
  { suffix: "openai", name: "OpenAI", prefix: "gpt-" },
]
export const PROVIDER_NPM = "@ai-sdk/openai-compatible"
export const HEADER_NAME = "x-github-repo"

export const BASE_URL = "https://litellm.ai.apro.is/v1"

export const OP_ACCOUNT = "aproorg.1password.eu"
export const OP_API_KEY_REF = "op://Employee/ai.apro.is litellm/API Key"
// First id present in the synced model list wins.
export const PREFERRED_MODELS = ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]
export const PREFERRED_SMALL_MODELS = ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]
