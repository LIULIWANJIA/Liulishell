# LIULI Shell website static build
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1
# If Node.js is installed, `node build.js` also works.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$electron = Join-Path $root '..\node_modules\electron\dist\electron.exe'

if (Get-Command node -ErrorAction SilentlyContinue) {
  & node (Join-Path $root 'build.js')
  exit $LASTEXITCODE
}

if (-not (Test-Path $electron)) {
  throw 'Node.js or the local Electron binary was not found. Run npm install in the project root, or install Node.js.'
}

Remove-Item Env:ELECTRON_FORCE_IS_PACKAGED -ErrorAction SilentlyContinue
$env:ELECTRON_RUN_AS_NODE = '1'
& $electron (Join-Path $root 'build.js')
exit $LASTEXITCODE
