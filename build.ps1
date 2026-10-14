# build.ps1 — 把插件目录打包成 .xpi（Zotero 插件格式，本质是 zip）
#
# 用法：
#   在 PowerShell 中切到本脚本所在目录后运行：
#       .\build.ps1
#   会在上级目录生成 zotero-obsidian-link.xpi
#
# 要求：
#   - 文件夹结构：zotero-obsidian-link/{manifest.json, bootstrap.js, prefs.js, content/, ...}
#   - manifest.json 必须位于 zip 根目录（不能带父文件夹路径）
#
# 打包后会自动校验 manifest.json 是否为合法 JSON。

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = $scriptDir
$parentDir  = Split-Path -Parent $projectDir
$xpiPath    = Join-Path $parentDir 'zotero-obsidian-link.xpi'

# 校验 manifest.json
$manifestPath = Join-Path $projectDir 'manifest.json'
if (-not (Test-Path $manifestPath)) {
    Write-Error "manifest.json not found: $manifestPath"
    exit 1
}
try {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    Write-Host "manifest.json OK (name=$($manifest.name), version=$($manifest.version))" -ForegroundColor Green
    $apps = $manifest.applications.zotero
    if (-not $apps) {
        Write-Warning "WARNING: applications.zotero missing - Zotero will refuse to install!"
    } else {
        Write-Host "  strict_min_version=$($apps.strict_min_version) strict_max_version=$($apps.strict_max_version)" -ForegroundColor DarkGray
    }
} catch {
    Write-Error "manifest.json is not valid JSON: $($_.Exception.Message)"
    exit 1
}

# 删除旧 xpi
if (Test-Path $xpiPath) {
    Remove-Item $xpiPath -Force
    Write-Host "Removed old .xpi" -ForegroundColor Yellow
}

# 用 .NET ZipFile 打包，确保 manifest.json 位于根目录
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($xpiPath, [System.IO.Compression.ZipArchiveMode]::Create)

try {
    $files = Get-ChildItem -Path $projectDir -Recurse -File |
             Where-Object { $_.Name -ne 'build.ps1' -and $_.Name -ne 'README.md' }

    foreach ($f in $files) {
        $rel = $f.FullName.Substring($projectDir.Length).TrimStart('\','/').Replace('\','/')
        $entry = $zip.CreateEntry($rel)
        $entry.LastWriteTime = $f.LastWriteTime
        $writer = New-Object System.IO.StreamWriter($entry.Open())
        try {
            $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
            $writer.BaseStream.Write($bytes, 0, $bytes.Length)
        } finally {
            $writer.Close()
        }
        Write-Host "  + $rel" -ForegroundColor DarkGray
    }
} finally {
    $zip.Dispose()
}

Write-Host ""
Write-Host ("Done: " + $xpiPath) -ForegroundColor Green
Write-Host "In Zotero: Tools -> Add-ons -> gear icon -> Install Add-on From File... -> pick the .xpi" -ForegroundColor Cyan
