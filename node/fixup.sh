#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

/bin/chmod +x "${DIR}/bin/n"
/bin/chmod +x "${DIR}/bin/n-uninstall"
/bin/chmod +x "${DIR}/bin/n-update"
/bin/chmod +x "${DIR}/bin/node"

if [ ! -f ${DIR}/bin/npm ]; then
    /bin/ln -s "${DIR}/lib/node_modules/npm/bin/npm-cli.js" "${DIR}/bin/npm"
fi

if [ ! -f ${DIR}/bin/npx ]; then
    /bin/ln -s "${DIR}/lib/node_modules/npm/bin/npx-cli.js" "${DIR}/bin/npx"
fi

/bin/chmod +x "${DIR}/bin/npm"
/bin/chmod +x "${DIR}/bin/npx"

