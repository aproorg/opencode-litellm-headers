import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Written by the installers, so the 1Password reference is not hardcoded.
// Same locations they use: %APPDATA%\opencode-apro on Windows, ~/.config/opencode-apro elsewhere.
export function settingsDir() {
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "opencode-apro")
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode-apro")
}

export async function readSettings() {
  const settings = {}
  let text
  try {
    text = await fs.readFile(path.join(settingsDir(), "local.env"), "utf8")
  } catch {
    return settings
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim())
    if (match) settings[match[1]] = match[2]
  }
  return settings
}
