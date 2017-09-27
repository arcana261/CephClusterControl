#!/bin/bash

VERSION="__VERSION__"

ACTIVE="$(/bin/systemctl is-active kaveh-cluster-ctrl.service)"
ENABLED="$(/bin/systemctl list-unit-files | grep kaveh-cluster-ctrl.service | awk '{print $2}')"

if [ "${ACTIVE}" == "active" ]; then
  /usr/bin/touch /tmp/.kaveh-cluster-ctrl-restart-service.cmd
fi
if [ "${ENABLED}" == "enabled" ]; then
  /usr/bin/touch /tmp/.kaveh-cluster-ctrl-enable-service.cmd
fi

if [ -f /etc/kaveh-cluster-ctrl.conf ]; then
    rm -f /tmp/.kaveh-cluster-ctrl.conf.old
    cp -f /etc/kaveh-cluster-ctrl.conf /tmp/.kaveh-cluster-ctrl.conf.old
fi

