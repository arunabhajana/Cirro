param(
    [string]$Repository = 'arunabhajana/Cirro',
    [string]$WebClientId = '399910149700-qd35ciugkeqdlniq9jnsvdjo4hq8jap2.apps.googleusercontent.com'
)
$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'This setup stores the local password with Windows DPAPI. Run it on Windows.' }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskDirectory = Join-Path $taskRoot '.qa/android-signing'
$taskKey = Join-Path $taskDirectory 'cirro-release.keystore'
$taskPasswordFile = Join-Path $taskDirectory 'password.dpapi'
$taskJdk = Get-ChildItem (Join-Path $taskRoot '.qa/android-tools/jdk21') -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'bin/keytool.exe') } | Select-Object -First 1
$taskKeytool = if ($taskJdk) { Join-Path $taskJdk.FullName 'bin/keytool.exe' } elseif ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin/keytool.exe' } else { throw 'Set JAVA_HOME to JDK 21.' }
$taskGh = (Get-Command gh -ErrorAction Stop).Source
function Set-CirroGitHubValue([string]$Kind, [string]$Name, [string]$Value) {
    $taskInfo = [Diagnostics.ProcessStartInfo]::new($taskGh)
    $taskInfo.UseShellExecute = $false
    $taskInfo.RedirectStandardInput = $true
    $taskInfo.RedirectStandardOutput = $true
    $taskInfo.RedirectStandardError = $true
    foreach ($taskArgument in @($Kind, 'set', $Name, '--repo', $Repository)) { $taskInfo.ArgumentList.Add($taskArgument) }
    $taskProcess = [Diagnostics.Process]::Start($taskInfo)
    try {
        $taskProcess.StandardInput.Write($Value)
        $taskProcess.StandardInput.Close()
        $taskOutput = $taskProcess.StandardOutput.ReadToEndAsync()
        $taskError = $taskProcess.StandardError.ReadToEndAsync()
        $taskProcess.WaitForExit()
        if ($taskProcess.ExitCode -ne 0) { throw "GitHub could not configure $Name. Check gh authentication and repository administration access." }
        Write-Host "Configured $Kind $Name"
    } finally { $taskProcess.Dispose() }
}
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
if ((Test-Path $taskKey) -ne (Test-Path $taskPasswordFile)) { throw 'A partial signing backup exists. Recover it before retrying; keys will not be overwritten.' }
try {
    if (Test-Path $taskPasswordFile) {
        $taskSecure = (Get-Content -LiteralPath $taskPasswordFile -Raw).Trim() | ConvertTo-SecureString
        $taskPassword = [Net.NetworkCredential]::new('', $taskSecure).Password
    } else {
        $taskPassword = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(36))
        ConvertTo-SecureString $taskPassword -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $taskPasswordFile
    }
    $env:CIRRO_SIGNING_SETUP_PASSWORD = $taskPassword
    if (!(Test-Path $taskKey)) {
        & $taskKeytool -genkeypair -keystore $taskKey -storetype PKCS12 -storepass:env CIRRO_SIGNING_SETUP_PASSWORD -keypass:env CIRRO_SIGNING_SETUP_PASSWORD -alias cirro-release -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Cirro, O=Cirro, C=IN'
        if ($LASTEXITCODE -ne 0) { throw 'Android signing-key generation failed. Keep the password backup for recovery.' }
    }
    $taskCertificate = & $taskKeytool -list -v -keystore $taskKey -storepass:env CIRRO_SIGNING_SETUP_PASSWORD -alias cirro-release
    if ($LASTEXITCODE -ne 0) { throw 'The saved Android key could not be opened.' }
    $taskCertificate | Set-Content -LiteralPath (Join-Path $taskDirectory 'certificate.txt')
    & $taskKeytool -exportcert -rfc -keystore $taskKey -storepass:env CIRRO_SIGNING_SETUP_PASSWORD -alias cirro-release -file (Join-Path $taskDirectory 'cirro-release-certificate.pem')
    if ($LASTEXITCODE -ne 0) { throw 'Certificate export failed.' }
    Set-CirroGitHubValue 'secret' 'ANDROID_KEYSTORE_BASE64' ([Convert]::ToBase64String([IO.File]::ReadAllBytes($taskKey)))
    Set-CirroGitHubValue 'secret' 'ANDROID_KEYSTORE_PASSWORD' $taskPassword
    Set-CirroGitHubValue 'secret' 'ANDROID_KEY_ALIAS' 'cirro-release'
    Set-CirroGitHubValue 'secret' 'ANDROID_KEY_PASSWORD' $taskPassword
    Set-CirroGitHubValue 'secret' 'ANDROID_GOOGLE_WEB_CLIENT_ID' $WebClientId
    Set-CirroGitHubValue 'variable' 'ANDROID_GOOGLE_WEB_CLIENT_ID' $WebClientId
    @'
Cirro Android production signing backup

cirro-release.keystore is the encrypted production key. Do not replace it for future releases.
password.dpapi is protected by Windows DPAPI and this Windows user profile.
certificate.txt and cirro-release-certificate.pem contain the PUBLIC signing certificate.

Keep a separate secure backup of the keystore and export its password to your password manager
while this Windows profile is available. Copying password.dpapi to a different PC will not unlock it.
To recover the password locally without printing it, use PowerShell:
  $secure = (Get-Content .qa/android-signing/password.dpapi -Raw).Trim() | ConvertTo-SecureString
  $credential = [Net.NetworkCredential]::new('', $secure)
The password is $credential.Password; store it privately. Never commit it or the keystore.

Build with the saved key: pwsh -File scripts/android-release-local.ps1
GitHub's five ANDROID_* release secrets are configured from this key. No release was published.
'@ | Set-Content -LiteralPath (Join-Path $taskDirectory 'README.txt')
    Write-Host "Protected signing backup: $taskDirectory"
    $taskCertificate | Select-String 'SHA1:|SHA256:' | ForEach-Object { Write-Host $_.Line.Trim() }
} finally {
    Remove-Item Env:CIRRO_SIGNING_SETUP_PASSWORD -ErrorAction SilentlyContinue
    $taskPassword = $null
}
