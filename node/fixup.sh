#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

/bin/chmod +x "${DIR}/bin/n"
/bin/chmod +x "${DIR}/bin/n-uninstall"
/bin/chmod +x "${DIR}/bin/n-update"
/bin/chmod +x "${DIR}/bin/node"
/bin/ln -s "${DIR}/lib/node_modules/npm/bin/npm-cli.js" "${DIR}/bin/npm"
/bin/ln -s "${DIR}/lib/node_modules/npm/bin/npx-cli.js" "${DIR}/bin/npx"
/bin/chmod +x "${DIR}/bin/npm"
/bin/chmod +x "${DIR}/bin/npx"

echo "Hello, ${DIR}!"
