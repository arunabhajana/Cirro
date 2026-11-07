$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskDirectory = Join-Path $taskRoot '.qa/android-signing'
$taskSecure = (Get-Content -LiteralPath (Join-Path $taskDirectory 'password.dpapi') -Raw).Trim() | ConvertTo-SecureString
$taskNames = @('CIRRO_ANDROID_KEYSTORE_PATH','CIRRO_ANDROID_KEYSTORE_PASSWORD','CIRRO_ANDROID_KEY_ALIAS','CIRRO_ANDROID_KEY_PASSWORD')
$taskPrevious = @{}
foreach ($taskName in $taskNames) { $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName,'Process') }
try {
    $env:CIRRO_ANDROID_KEYSTORE_PATH = Join-Path $taskDirectory 'cirro-release.keystore'
    $env:CIRRO_ANDROID_KEYSTORE_PASSWORD = [Net.NetworkCredential]::new('', $taskSecure).Password
    $env:CIRRO_ANDROID_KEY_ALIAS = 'cirro-release'
    $env:CIRRO_ANDROID_KEY_PASSWORD = $env:CIRRO_ANDROID_KEYSTORE_PASSWORD
    Push-Location $taskRoot
    try { & npm.cmd run android:release:apk; $taskExit = $LASTEXITCODE } finally { Pop-Location }
} finally {
    foreach ($taskName in $taskNames) { [Environment]::SetEnvironmentVariable($taskName,$taskPrevious[$taskName],'Process') }
}
exit $taskExit
