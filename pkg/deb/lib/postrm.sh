#!/bin/bash

VERSION="__VERSION__"

if [ ! -f /usr/local/lib/kaveh-cluster-ctrl/VERSION ]; then
  echo "${VERSION}" > /usr/local/lib/kaveh-cluster-ctrl/VERSION
fi

CUR_VERSION="$(cat /usr/local/lib/kaveh-cluster-ctrl/VERSION)"
HAS="$(/bin/systemctl list-unit-files | grep kaveh-cluster-ctrl.service | awk '{print $1}')"

if [ "${VERSION}" == "${CUR_VERSION}" ]; then
  if [ "${HAS}" == "kaveh-cluster-ctrl.service" ]; then
    /bin/systemctl stop kaveh-cluster-ctrl.service || true
    /bin/systemctl disable kaveh-cluster-ctrl.service || true
  fi

  /bin/rm -f /lib/systemd/system/kaveh-cluster-ctrl.service

  /bin/systemctl daemon-reload

  /bin/rm -f /usr/local/bin/kluster-cli || true
  /bin/rm -f /usr/local/bin/kluster-agent || true
  /bin/rm -f /usr/local/lib/kaveh-cluster-ctrl/node/bin/npm
  /bin/rm -f /usr/local/lib/kaveh-cluster-ctrl/node/bin/npx
  /bin/rm -f /usr/local/lib/kaveh-cluster-ctrl/VERSION
  /bin/rm -rf /usr/local/lib/kaveh-cluster-ctrl/targetcli-backup
  /bin/rm -f /etc/kaveh-cluster-ctrl.conf
  /bin/rm -rf /var/lib/kaveh-cluster-ctrl

  if [ -d "/tmp/kaveh-agent-token" ]; then
    /bin/rm -rf /tmp/kaveh-agent-token
  fi

  if [ -d "/tmp/kaveh-multipart" ]; then
    /bin/rm -rf /tmp/kaveh-multipart
  fi

  if [ -d "/tmp/kaveh-updater" ]; then
    /bin/rm -rf /tmp/kaveh-updater
  fi
fi

