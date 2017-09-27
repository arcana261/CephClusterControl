#!/bin/bash

VERSION="__VERSION__"

if [ ! -f /usr/local/lib/kaveh-cluster-ctrl/VERSION ]; then
  echo "${VERSION}" > /usr/local/lib/kaveh-cluster-ctrl/VERSION
fi

CUR_VERSION="$(cat /usr/local/lib/kaveh-cluster-ctrl/VERSION)"
ACTIVE="$(/bin/systemctl is-active kaveh-cluster-ctrl.service)"
ENABLED="$(/bin/systemctl list-unit-files | grep kaveh-cluster-ctrl.service | awk '{print $2}')"

if [ "${VERSION}" == "${CUR_VERSION}" ]; then
  if [ "${ACTIVE}" == "active" ]; then
    /usr/bin/touch /tmp/.kaveh-cluster-ctrl-restart-service.cmd
  fi
  if [ "${ENABLED}" == "enabled" ]; then
    /usr/bin/touch /tmp/.kaveh-cluster-ctrl-enable-service.cmd
  fi

  systemctl stop kaveh-cluster-ctrl.service || true
  systemctl disable kaveh-cluster-ctrl.service || true

  rm -rf /var/lib/kaveh-cluster-ctrl/cluster.db || true
fi

