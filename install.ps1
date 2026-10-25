# Uiable Connect — one-line Docker install for Windows.
#   irm https://raw.githubusercontent.com/AlfieeLawrence/uiable-connect/main/install.ps1 | iex
# Enables Docker Desktop host networking when possible (forwards get ANY PC port),
# otherwise installs with the 8000-8099 port pool.
$img = 'ghcr.io/alfieelawrence/uiable-connect:latest'
docker pull $img | Out-Null
docker rm -f uiable-connect 2>$null | Out-Null

# Flip Docker Desktop's host-networking flag if the settings file exists (applies after restart)
$settingsFile = "$env:APPDATA\Docker\settings-store.json"
$hostNet = $false
if (Test-Path $settingsFile) {
  try {
    $s = Get-Content $settingsFile -Raw | ConvertFrom-Json
    if (-not $s.HostNetworkingEnabled) {
      $s | Add-Member -NotePropertyName HostNetworkingEnabled -NotePropertyValue $true -Force
      $s | ConvertTo-Json -Depth 20 | Set-Content $settingsFile
      Write-Host "Enabled Docker Desktop host networking in settings."
      try { Restart-Service com.docker.service -ErrorAction Stop; Write-Host "Restarted Docker Desktop." }
      catch { Write-Host "Could not restart Docker Desktop automatically — please restart it from the tray." }
      Start-Sleep -Seconds 8
    }
    $hostNet = $true
  } catch { }
}

$ok = $false
if ($hostNet) {
  try { docker run -d --name uiable-connect --restart unless-stopped --network host -e UC_HOST_NET=1 -e UC_FWD_BIND=127.0.0.1 -v uiable-connect-data:/data $img | Out-Null; $ok = $true } catch { }
}
if ($ok) { Write-Host "Installed (host networking) - open http://localhost:8484 - forwards can use ANY PC port" }
else {
  docker run -d --name uiable-connect --restart unless-stopped -p 127.0.0.1:8484:8484 -p "127.0.0.1:8000-8099:8000-8099" -v uiable-connect-data:/data $img | Out-Null
  Write-Host "Installed (port pool) - open http://localhost:8484 - forwards can use PC ports 8000-8099"
  Write-Host "Tip: enable Docker Desktop host networking (Settings > Resources > Network) and run:"
  Write-Host "  docker rm -f uiable-connect; docker run -d --name uiable-connect --network host -e UC_HOST_NET=1 -v uiable-connect-data:/data $img"
}
