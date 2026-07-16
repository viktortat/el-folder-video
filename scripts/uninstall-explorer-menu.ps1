$classes = 'HKCU:\Software\Classes'
Remove-Item -LiteralPath "$classes\Directory\shell\FolderVideo" -Recurse -Force -ErrorAction SilentlyContinue
foreach ($extension in '.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.ogv') {
  Remove-Item -LiteralPath "$classes\SystemFileAssociations\$extension\shell\FolderVideo" -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host 'Folder-video Explorer menu entries were removed.'
