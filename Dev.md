bun run package && bun run start
bun run package && bun run make && start 'out/make/squirrel.windows/x64/folder-video-setup.exe'

bunx --no-install electron-forge make

start 'out\make\squirrel.windows\x64\folder-video-setup.exe'