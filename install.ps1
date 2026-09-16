#!/usr/bin/env pwsh
# Windows installer. See install.sh for macOS/Linux.

$ErrorActionPreference = "Stop"

$Plugin = if ($env:OPENCODE_LITELLM_PLUGIN_SPEC) { $env:OPENCODE_LITELLM_PLUGIN_SPEC }
          else { "@aproorg/opencode-litellm-headers@git+https://github.com/aproorg/opencode-litellm-headers.git" }
$ConfigDir = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } else { Join-Path $HOME ".config\opencode" }
$ConfigPath = Join-Path $ConfigDir "opencode.json"

function Have($name) { $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

function Ask($question) {
  if ($env:OPENCODE_ASSUME_YES -eq "1") { return $true }
  $reply = Read-Host "$question [y/N]"
  return $reply -match '^[Yy]'
}

# 1. opencode itself
if (-not (Have "opencode")) {
  Write-Host "Installing opencode..."
  if (Have "scoop") { scoop install opencode }
  elseif (Have "choco") { choco install opencode -y }
  elseif (Have "npm") { npm install -g opencode-ai@latest }
  else { throw "Install a package manager first (scoop.sh or chocolatey.org), then rerun. See https://opencode.ai" }
}
Write-Host "opencode $(opencode --version) at $((Get-Command opencode).Source)"

# 2. config: add the plugin, retire settings the plugin now manages
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

# opencode.json is the file we manage; config.json and opencode.jsonc also load and would override it.
foreach ($other in @("opencode.jsonc", "config.json")) {
  $otherPath = Join-Path $ConfigDir $other
  if (Test-Path $otherPath) {
    $moved = "$otherPath.bak-$(Get-Date -Format yyyyMMddHHmmss)"
    Move-Item $otherPath $moved
    Write-Host "Moved $other aside - it overrides opencode.json. Old settings: $moved"
  }
}

$config = [ordered]@{}
if (Test-Path $ConfigPath) {
  Copy-Item $ConfigPath "$ConfigPath.bak-$(Get-Date -Format yyyyMMddHHmmss)"
  $parsed = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  foreach ($property in $parsed.PSObject.Properties) { $config[$property.Name] = $property.Value }
}

$managed = @("provider", "model", "small_model", "mcp") | Where-Object { $config.Contains($_) }
if ($managed) {
  Write-Host ""
  Write-Host "Your config still sets: $($managed -join ', ')"
  Write-Host "The plugin manages these now, and your own values take precedence - stale model ids stay in the picker."
  if (Ask "Remove them (a backup is kept)?") {
    foreach ($key in $managed) { $config.Remove($key) }
  } else {
    Write-Host "Leaving them; remove them by hand later if the model list looks wrong."
  }
}

if (-not $config.Contains('$schema')) { $config['$schema'] = "https://opencode.ai/config.json" }
$plugins = @($config["plugin"]) | Where-Object { $_ -and ($_ -notlike "*opencode-litellm-headers*") }
$config["plugin"] = @($plugins) + @($Plugin)

ConvertTo-Json $config -Depth 20 | Set-Content $ConfigPath -Encoding UTF8
Write-Host "Wrote $ConfigPath"

# 3. optional runtimes for the local MCP servers
if (-not (Have "npx") -and -not (Have "bunx")) {
  Write-Host "Note: no npx or bunx found - the local MCP servers are skipped. Models and chat work regardless."
}
if (-not (Have "uvx")) {
  Write-Host "Note: no uvx found - the fetch/time/git MCP servers are skipped. Models and chat work regardless."
}

# 4. first launch: install the plugin, fetch the model list
Write-Host ""
Write-Host "Setting up (first run downloads the plugin and syncs models)..."
$models = @(opencode models --provider litellm 2>$null | Where-Object { $_ })

Write-Host ""
if ($models.Count -gt 0) {
  Write-Host "Done - $($models.Count) models available. Start with: opencode"
} else {
  Write-Host "Setup finished, but no models came back."
  Write-Host "Check your LiteLLM key is in 1Password as: op://Employee/ai.apro.is litellm/API Key"
  Write-Host "Then run: op signin --account aproorg.1password.eu; opencode models --provider litellm"
  exit 1
}
