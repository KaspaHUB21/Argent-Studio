[CmdletBinding()]
param(
    [string]$Installer,
    [string]$ArtifactRoot,
    [ValidateRange(30, 600)][int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This smoke check requires Windows.' }
$projectRoot = Split-Path $PSScriptRoot -Parent
if (!$ArtifactRoot) { $ArtifactRoot = Join-Path $projectRoot 'src-tauri/target/release' }
$ArtifactRoot = [IO.Path]::GetFullPath($ArtifactRoot)
$runRoot = Join-Path $projectRoot ('test-output/ci-windows/' + [Guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $runRoot 'application'
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$summary = [ordered]@{ success = $false; installationTested = [bool]$Installer; examples = @(); backend = $null; ui = $null; error = $null }

function Invoke-BoundedProcess {
    param([string]$FilePath, [string]$Arguments, [int]$Seconds = $TimeoutSeconds, [string]$LogPrefix)
    $processOptions = @{ FilePath = $FilePath; ArgumentList = $Arguments; WorkingDirectory = $packageRoot; WindowStyle = 'Hidden'; PassThru = $true }
    if ($LogPrefix) { $processOptions.RedirectStandardOutput = "$LogPrefix.stdout.txt"; $processOptions.RedirectStandardError = "$LogPrefix.stderr.txt" }
    $process = Start-Process @processOptions
    try {
        if (!$process.WaitForExit($Seconds * 1000)) {
            try { $process.Kill($true) } catch { $process.Kill() }
            throw "Process timed out after $Seconds seconds: $([IO.Path]::GetFileName($FilePath))"
        }
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw "Process failed with exit code $($process.ExitCode): $([IO.Path]::GetFileName($FilePath))" }
    } finally { $process.Dispose() }
}

function Assert-ApplicationIcon {
    param([string]$Executable)
    Add-Type -AssemblyName System.Drawing
    $actualIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($Executable)
    $expectedIcon = [System.Drawing.Icon]::new((Join-Path $projectRoot 'src-tauri/icons/icon.ico'), $actualIcon.Size)
    $actual = $actualIcon.ToBitmap()
    $expected = $expectedIcon.ToBitmap()
    try {
        $matches = 0
        for ($y = 0; $y -lt $actual.Height; $y++) {
            for ($x = 0; $x -lt $actual.Width; $x++) {
                $a = $actual.GetPixel($x, $y); $b = $expected.GetPixel($x, $y)
                if (($a.A -eq 0 -and $b.A -eq 0) -or $a.ToArgb() -eq $b.ToArgb()) { $matches++ }
            }
        }
        if ($matches / ($actual.Width * $actual.Height) -lt 0.95) { throw "Unexpected application icon: $([IO.Path]::GetFileName($Executable))" }
        Write-Host "Application icon verified: $([IO.Path]::GetFileName($Executable))"
    } finally { $actual.Dispose(); $expected.Dispose(); $actualIcon.Dispose(); $expectedIcon.Dispose() }
}

function Invoke-Smoke {
    param([string]$Executable, [string]$Mode, [string]$ReportOption, [string]$ReportName)
    $reportPath = Join-Path $runRoot $ReportName
    try {
        Invoke-BoundedProcess -FilePath $Executable -Arguments "$Mode $ReportOption `"$reportPath`""
    } catch {
        $failure = $_.Exception.Message
        if (Test-Path -LiteralPath $reportPath -PathType Leaf) {
            $details = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
            if ($details.PSObject.Properties['error']) { $failure += ": $($details.error)" }
        }
        throw $failure
    }
    if (!(Test-Path -LiteralPath $reportPath -PathType Leaf)) { throw "Smoke report was not created: $ReportName" }
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    if ($report.success -ne $true) {
        $failure = "Smoke report failed: $ReportName"
        if ($report.PSObject.Properties['error']) { $failure += ": $($report.error)" }
        throw $failure
    }
    return $report
}

$priorProjects = $env:ARGENT_PROJECTS_DIR
$priorAppData = $env:APPDATA
try {
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    if ($Installer) {
        if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
            throw 'Silent installation is restricted to disposable GitHub-hosted Actions runners.'
        }
        $installerPath = (Resolve-Path -LiteralPath $Installer).Path
        if ([IO.Path]::GetExtension($installerPath) -ne '.exe') { throw 'Expected an NSIS installer executable.' }
        # NSIS requires /D to be the final argument, with no quotes around its value.
        Invoke-BoundedProcess -FilePath $installerPath -Arguments "/S /D=$packageRoot" -Seconds 300
    } else {
        Copy-Item -LiteralPath (Join-Path $ArtifactRoot 'argent-studio-tauri.exe') -Destination $packageRoot
        Copy-Item -LiteralPath (Join-Path $projectRoot 'resources') -Destination $packageRoot -Recurse
    }
    $application = Join-Path $packageRoot 'argent-studio-tauri.exe'
    $binaries = @($application,
        (Join-Path $packageRoot 'resources/bin/argentc.exe'),
        (Join-Path $packageRoot 'resources/bin/ArgentTestRunner-v1.exe'),
        (Join-Path $packageRoot 'resources/bin/runtime/node.exe'))
    foreach ($binary in $binaries) {
        if (!(Test-Path -LiteralPath $binary -PathType Leaf) -or (Get-Item -LiteralPath $binary).Length -eq 0) { throw "Required binary missing or empty: $binary" }
    }
    Assert-ApplicationIcon -Executable $application
    if ($Installer) {
        Assert-ApplicationIcon -Executable $installerPath
        Assert-ApplicationIcon -Executable (Join-Path $packageRoot 'uninstall.exe')
    }
    & node (Join-Path $PSScriptRoot 'check-binary-paths.mjs') @binaries
    if ($LASTEXITCODE -ne 0) { throw 'Personal build path scan failed.' }
    $examples = @(
        @{ Id = 'tickets'; Entry = 'tickets.ag'; App = 'Tickets' },
        @{ Id = 'spawns'; Entry = 'spawns.ag'; App = 'Spawns' },
        @{ Id = 'stones'; Entry = 'app.ag'; App = 'Stones' },
        @{ Id = 'icc'; Entry = 'minter.ag'; App = 'KCC20MintController' }
    )
    foreach ($example in $examples) {
        $entry = Join-Path $packageRoot ("resources/examples/catalog/$($example.Id)/$($example.Entry)")
        $output = Join-Path $runRoot ("examples/$($example.Id)")
        New-Item -ItemType Directory -Path $output -Force | Out-Null
        Invoke-BoundedProcess -FilePath $binaries[1] -Arguments "build `"$entry`" --app $($example.App) --out `"$output`"" -LogPrefix (Join-Path $output 'compiler')
        $artifact = Join-Path $output 'artifact.json'
        if (!(Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "Example artifact missing: $($example.Id)" }
        Get-Content -LiteralPath $artifact -Raw | ConvertFrom-Json | Out-Null
        $summary.examples += @{ id = $example.Id; success = $true; artifact = $artifact }
    }
    $env:ARGENT_PROJECTS_DIR = Join-Path $runRoot 'projects'
    $env:APPDATA = Join-Path $runRoot 'profile'
    New-Item -ItemType Directory -Path $env:ARGENT_PROJECTS_DIR, $env:APPDATA -Force | Out-Null
    $summary.backend = Invoke-Smoke -Executable $application -Mode '--smoke-test' -ReportOption '--smoke-report' -ReportName 'backend.json'
    $summary.ui = Invoke-Smoke -Executable $application -Mode '--ui-smoke' -ReportOption '--ui-smoke-report' -ReportName 'ui.json'
    $summary.success = $true
    Write-Host "Windows smoke checks passed. Reports: $runRoot"
} catch {
    $summary.error = $_.Exception.Message
    throw
} finally {
    $env:ARGENT_PROJECTS_DIR = $priorProjects
    $env:APPDATA = $priorAppData
    $summary | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath (Join-Path $runRoot 'summary.json') -Encoding utf8
}
