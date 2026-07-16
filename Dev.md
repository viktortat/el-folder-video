bun install
bun run package
bun run start

bun run make
start out/make/squirrel.windows/x64/folder-video-setup.exe 

bun install
bun run package:mac   
bun run make:mac      

./scripts/install-explorer-menu.sh
./scripts/uninstall-explorer-menu.sh

bun run package && bun run start
bun run package && bun run make && start out/make/squirrel.windows/x64/folder-video-setup.exe 