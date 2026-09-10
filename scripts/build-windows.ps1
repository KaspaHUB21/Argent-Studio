$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot
$keyPath=Join-Path $env:USERPROFILE '.tauri/argent-studio-updater.key'
$passwordPath=Join-Path $env:USERPROFILE '.tauri/argent-studio-updater.password.dpapi'
if(!(Test-Path -LiteralPath $keyPath) -or !(Test-Path -LiteralPath $passwordPath)){throw 'Updater signing key/password not provisioned on this Windows account.'}
try {
 $secure=Get-Content -Raw -LiteralPath $passwordPath | ConvertTo-SecureString
 $env:TAURI_SIGNING_PRIVATE_KEY=$keyPath
 $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=[System.Net.NetworkCredential]::new('', $secure).Password
 Push-Location $projectRoot
 try { & node node_modules/@tauri-apps/cli/tauri.js build --bundles nsis; if($LASTEXITCODE -ne 0){throw 'Windows build failed'} } finally {Pop-Location}
} finally {Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY,Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue;$secure=$null}
