#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

(cd "${DIR}" && "${DIR}/../../node_modules/.bin/sequelize" $@)

