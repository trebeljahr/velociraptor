#!/bin/bash
export PATH="/Users/rico/.nvm/versions/node/v22.20.0/bin:$PATH"
cd "$(dirname "$0")/.."
exec /Users/rico/.nvm/versions/node/v22.20.0/bin/npx --yes serve -l 3456 .
