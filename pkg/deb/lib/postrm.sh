#!/bin/bash

HAS="$(/bin/systemctl list-unit-files | grep kaveh-cluster-ctrl.service | awk '{print $1}')"

if [ "${HAS}" == "kaveh-cluster-ctrl.service" ]; then
    /bin/systemctl stop kaveh-cluster-ctrl.service || true
    /bin/systemctl disable kaveh-cluster-ctrl.service || true
fi

/bin/rm -f /lib/systemd/system/kaveh-cluster-ctrl.service

/bin/systemctl daemon-reload

HAS2="$(/bin/systemctl list-unit-files | grep kaveh-cluster-ctrl.service | awk '{print $1}')"

if [ "${HAS2}" == "kaveh-cluster-ctrl.service" ]; then
    /bin/systemctl stop kaveh-cluster-ctrl.service || true
    /bin/systemctl disable kaveh-cluster-ctrl.service || true
fi

/bin/rm -f /usr/local/bin/kluster-cli || true
/bin/rm -f /usr/local/bin/kluster-agent || true
/bin/rm -f /usr/local/lib/kaveh-cluster-ctrl/node/bin/npm
/bin/rm -f /usr/local/lib/kaveh-cluster-ctrl/node/bin/npx
