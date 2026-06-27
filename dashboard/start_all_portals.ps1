# One-shot: gateway + dashboards + tunnels (no background loop).
$ErrorActionPreference = "Continue"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here "lib.ps1")
Start-PortalStack
