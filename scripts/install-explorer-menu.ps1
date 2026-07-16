param(
  [string]$AppPath = (Join-Path $PSScriptRoot '..\out\folder-video-win32-x64\folder-video.exe')
)

$AppPath = [System.IO.Path]::GetFullPath($AppPath)
if (-not (Test-Path -LiteralPath $AppPath -PathType Leaf)) {
  throw "Application executable was not found: $AppPath"
}

function Add-ExplorerCommand([string]$KeyPath, [string]$Label) {
  New-Item -Path $KeyPath -Force | Out-Null
  New-ItemProperty -Path $KeyPath -Name '(default)' -Value $Label -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $KeyPath -Name 'Icon' -Value "$AppPath,0" -PropertyType String -Force | Out-Null
  New-Item -Path "$KeyPath\command" -Force | Out-Null
  New-ItemProperty -Path "$KeyPath\command" -Name '(default)' -Value ('"{0}" "%1"' -f $AppPath) -PropertyType String -Force | Out-Null
}

$classes = 'HKCU:\Software\Classes'
Add-ExplorerCommand "$classes\Directory\shell\FolderVideo" 'Open in Folder-video'
foreach ($extension in '.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.ogv') {
  Add-ExplorerCommand "$classes\SystemFileAssociations\$extension\shell\FolderVideo" 'Open video in Folder-video'
}
Write-Host 'Folder-video Explorer menu entries were installed.'
