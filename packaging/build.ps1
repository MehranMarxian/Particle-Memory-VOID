# Builds VOID.scr: embeds the vite dist/ output into a single-file
# Windows screensaver (packaging/void-scr.cs) compiled with the .NET
# Framework compiler that ships with Windows — no SDK required.
#
# Usage:  powershell -ExecutionPolicy Bypass -File packaging\build.ps1
# Result: packaging\VOID.scr   (right-click -> Install, Test, Configure)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$repo = Split-Path $root -Parent
Set-Location $repo

Write-Host "==> npm run build"
& npm run build
if ($LASTEXITCODE -ne 0) { throw "vite build failed" }

if (-not (Test-Path "$repo\dist\index.html")) { throw "dist/index.html missing" }

# Locate the inbox C# compiler.
$csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw "csc.exe not found (install .NET Framework 4.x)" }

# Embed every dist file: name = relative path with '\' and '/' -> '.'
# Stage dist into a space-free temp dir: csc response files dislike quoted
# "file,name" resource specs, and the repo path contains spaces.
$stage = Join-Path $env:TEMP "void-scr-build"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item "$repo\dist" "$stage\dist" -Recurse

$distRoot = (Get-Item "$stage\dist").FullName
$resArgs = @()
Get-ChildItem $distRoot -Recurse -File | Where-Object { $_.Extension -ne ".obj" } | ForEach-Object {
    $rel = $_.FullName.Substring($distRoot.Length + 1).Replace('\', '.').Replace('/', '.')
    $resArgs += "/res:$($_.FullName),$rel"
}

$rsp = Join-Path $root "build.rsp"
$outScr = Join-Path $root "VOID.scr"
$lines = @(
    "/target:winexe",
    "/optimize+",
    "/out:`"$outScr`""
) + $resArgs + @(
    "/r:System.dll",
    "/r:System.Core.dll",
    "`"$(Join-Path $root 'void-scr.cs')`""
)
$lines | Set-Content -Encoding ASCII $rsp

Write-Host "==> csc -> VOID.scr"
& $csc "@$rsp" -nologo
if ($LASTEXITCODE -ne 0) { throw "csc failed" }

$size = [math]::Round((Get-Item (Join-Path $root "VOID.scr")).Length / 1MB, 2)
Write-Host "==> built packaging\VOID.scr ($size MB)"
Write-Host ""
Write-Host "Install:    right-click VOID.scr -> Install"
Write-Host "Test now:   double-click VOID.scr"
Write-Host "Configure:  right-click VOID.scr -> Configure (opens the editor)"
Write-Host "Sources:    drop images into $env:USERPROFILE\Documents\VOID\Sources"
Write-Host "Uninstall:  delete %SystemRoot%\System32\VOID.scr"
