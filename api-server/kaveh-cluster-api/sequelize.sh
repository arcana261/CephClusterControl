#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

pushd "${DIR}"

{
  "${DIR}/../../node_modules/.bin/sequelize" $@
  popd
} || {
  popd
}

