#!/usr/bin/env pwsh
# Windows installer. See install.sh for macOS/Linux.

$ErrorActionPreference = "Stop"

$Repo = "aproorg/opencode-litellm-headers"
$Ref = if ($env:OPENCODE_LITELLM_REF) { $env:OPENCODE_LITELLM_REF } else { "main" }
$PluginHome = if ($env:OPENCODE_LITELLM_HOME) { $env:OPENCODE_LITELLM_HOME } else { Join-Path $HOME ".local\share\apro-opencode" }
# Not OPENCODE_CONFIG_DIR: other tooling sets that, and we would write into its config.
$ConfigDir = if ($env:OPENCODE_LITELLM_CONFIG_DIR) { $env:OPENCODE_LITELLM_CONFIG_DIR } else { Join-Path $HOME ".config\opencode" }
$ConfigPath = Join-Path $ConfigDir "opencode.json"
$cacheHome = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME ".cache" }
$stamp = Get-Date -Format yyyyMMddHHmmss

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

# 2. the plugin itself, as files we own - rerunning this script is the update path
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("apro-opencode-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  Write-Host "Downloading plugin ($Ref)..."
  $tarball = Join-Path $tmp "plugin.tar.gz"
  Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/tar.gz/$Ref" -OutFile $tarball -UseBasicParsing
  tar -xzf $tarball -C $tmp
  if ($LASTEXITCODE -ne 0) { throw "could not extract the plugin archive" }

  $src = Get-ChildItem -Path $tmp -Directory -Recurse -Depth 1 | Where-Object { $_.Name -eq "src" } | Select-Object -First 1
  if (-not $src) { throw "downloaded archive has no src directory" }

  $sha = "unknown"
  try {
    $commit = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Ref" -UseBasicParsing
    $sha = $commit.sha.Substring(0, 7)
  } catch { }

  New-Item -ItemType Directory -Force -Path (Split-Path $PluginHome -Parent) | Out-Null
  if (Test-Path $PluginHome) { Remove-Item -Recurse -Force $PluginHome }
  Move-Item $src.FullName $PluginHome
  Set-Content -Path (Join-Path $PluginHome "VERSION") -Value "$Ref $sha" -Encoding UTF8
  Write-Host "Installed plugin $Ref ($sha) to $PluginHome"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# 3. config
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

# opencode.json is the file we manage; config.json and opencode.jsonc also load and would override it.
foreach ($other in @("opencode.jsonc", "config.json")) {
  $otherPath = Join-Path $ConfigDir $other
  if (Test-Path $otherPath) {
    $moved = "$otherPath.bak-$stamp"
    Move-Item $otherPath $moved
    Write-Host "Moved $other aside - it overrides opencode.json. Old settings: $moved"
  }
}

$config = [ordered]@{}
if (Test-Path $ConfigPath) {
  Copy-Item $ConfigPath "$ConfigPath.bak-$stamp"
  try {
    $parsed = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    foreach ($property in $parsed.PSObject.Properties) { $config[$property.Name] = $property.Value }
  } catch {
    Move-Item $ConfigPath "$ConfigPath.unparsed-$stamp"
    Write-Host "opencode.json has comments or trailing commas and cannot be edited safely."
    Write-Host "Kept as $ConfigPath.unparsed-$stamp - merge anything you need back by hand."
    $config = [ordered]@{}
  }
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
$entry = "file:///" + ($PluginHome -replace '\\', '/').TrimStart('/') + "/index.js"
$plugins = @($config["plugin"]) | Where-Object { $_ -and ($_ -notlike "*opencode-litellm-headers*") -and ($_ -notlike "*apro-opencode*") }
$config["plugin"] = @($plugins) + @($entry)

ConvertTo-Json $config -Depth 20 | Set-Content $ConfigPath -Encoding UTF8
Write-Host "Wrote $ConfigPath"

# Earlier versions were installed as a package; leaving that cached would load the plugin twice.
$pluginCache = Join-Path $cacheHome "opencode\packages\@aproorg"
if (Test-Path $pluginCache) { Remove-Item -Recurse -Force $pluginCache }

# 4. verify
Write-Host ""
Write-Host "Syncing models..."
$models = @(opencode models 2>$null | Where-Object { $_ -match "^litellm(/|-)" })

Write-Host ""
if ($models.Count -gt 0) {
  Write-Host "Done - $($models.Count) models available. Start with: opencode"
  Write-Host "Run this command again at any time to update."
} else {
  Write-Host "Setup finished, but no models came back."
  Write-Host "Check your LiteLLM key is in 1Password as: op://Employee/ai.apro.is litellm/API Key"
  Write-Host "Then run: op signin --account aproorg.1password.eu; opencode models"
  exit 1
}
