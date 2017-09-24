#!/bin/bash

if [ -f /etc/kaveh-cluster-ctrl.conf ]; then
    rm -f /tmp/.kaveh-cluster-ctrl.conf.old
    cp -f /etc/kaveh-cluster-ctrl.conf /tmp/.kaveh-cluster-ctrl.conf.old
fi
