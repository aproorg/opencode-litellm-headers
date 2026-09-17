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
$OpAccount = "aproorg.1password.eu"
$OpKeyRef = "op://Employee/ai.apro.is litellm/API Key"
$stamp = Get-Date -Format yyyyMMddHHmmss

function Have($name) { $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

function Ask($question) {
  if ($env:OPENCODE_ASSUME_YES -eq "1") { return $true }
  $reply = Read-Host "$question [y/N]"
  return $reply -match '^[Yy]'
}

# Windows PowerShell 5.1 writes a BOM for -Encoding UTF8, and other encodings write UTF-16.
# opencode parses this file as JSON(C) and rejects both, so write the bytes ourselves.
function Write-Utf8NoBom($path, $text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

# Returns a reason the file is unusable, or $null when it parses.
function Get-ConfigProblem($path) {
  if (-not (Test-Path $path)) { return "it was not created" }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -eq 0) { return "it is empty" }
  if ($bytes[0] -ne 0x7B) {
    $head = (($bytes | Select-Object -First 4 | ForEach-Object { $_.ToString("x2") }) -join " ")
    return "it does not start with '{' (first bytes: $head)"
  }
  # UTF-16LE also starts with 7b; the NUL after it is the giveaway.
  if ($bytes.Length -gt 1 -and $bytes[1] -eq 0x00) { return "it is UTF-16 encoded, not UTF-8" }
  try { [System.IO.File]::ReadAllText($path) | ConvertFrom-Json | Out-Null } catch { return "it is not valid JSON: $($_.Exception.Message)" }
  return $null
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
  if (Test-Path $PluginHome) {
    # Windows locks files an open opencode is using; POSIX does not.
    try { Remove-Item -Recurse -Force $PluginHome }
    catch { throw "could not replace $PluginHome - close any running opencode, then rerun. ($($_.Exception.Message))" }
  }
  Move-Item $src.FullName $PluginHome
  Write-Utf8NoBom (Join-Path $PluginHome "VERSION") "$Ref $sha"
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

$json = ConvertTo-Json $config -Depth 20
if ([string]::IsNullOrWhiteSpace($json)) { $json = "" } else { Write-Utf8NoBom $ConfigPath $json }

# Never leave a config opencode cannot read: fall back to the one entry the plugin needs.
$problem = if ($json) { Get-ConfigProblem $ConfigPath } else { "it could not be serialised" }
if ($problem) {
  Write-Host "Merging your existing settings produced a config opencode cannot read - $problem"
  Write-Host "Writing a minimal config instead; your old one is kept as $ConfigPath.bak-$stamp"
  Write-Utf8NoBom $ConfigPath ('{"$schema":"https://opencode.ai/config.json","plugin":["' + $entry + '"]}')
  $problem = Get-ConfigProblem $ConfigPath
  if ($problem) { throw "could not write a usable $ConfigPath - $problem" }
}
Write-Host "Wrote $ConfigPath"

# Earlier versions were installed as a package; leaving that cached would load the plugin twice.
$pluginCache = Join-Path $cacheHome "opencode\packages\@aproorg"
if (Test-Path $pluginCache) { Remove-Item -Recurse -Force $pluginCache }

# 4. verify
Write-Host ""
Write-Host "Syncing models..."
# $ErrorActionPreference is Stop, and anything opencode writes to stderr would abort the
# script with a raw node trace instead of the diagnosis below.
$previous = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$output = @(& opencode models 2>&1 | ForEach-Object { $_.ToString() })
$ErrorActionPreference = $previous
$models = @($output | Where-Object { $_ -match "^litellm(/|-)" })

Write-Host ""
if ($models.Count -gt 0) {
  Write-Host "Done - $($models.Count) models available. Start with: opencode"
  Write-Host "Run this command again at any time to update."
} else {
  Write-Host "Setup finished, but no models came back."
  Write-Host ""

  # Say which of the two it is, rather than handing over a checklist.
  if (-not (Have "op")) {
    Write-Host "The 1Password CLI (op) is not installed, and that is where the LiteLLM key comes from."
    Write-Host "Install it from https://1password.com/downloads/command-line/ then run this command again."
  } else {
    $probe = & op --account $OpAccount read $OpKeyRef 2>&1
    if ($LASTEXITCODE -eq 0 -and $probe) {
      Write-Host "1Password gave us the key, so the problem is the gateway or the plugin, not your setup."
      Write-Host "Send this output to the team."
    } else {
      Write-Host "1Password could not give us the key:"
      Write-Host "  $probe"
      Write-Host ""
      Write-Host "In the 1Password app: Settings > Developer > Integrate with 1Password CLI,"
      Write-Host "then check you can open this item: $OpKeyRef"
    }
  }

  if ($output.Count -gt 0) {
    Write-Host ""
    Write-Host "opencode said:"
    $output | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
  }

  # Not exit: this script is run through `irm ... | iex`, where exit closes the user's terminal
  # and takes everything above with it.
  Write-Host ""
  throw "opencode returned no LiteLLM models."
}
