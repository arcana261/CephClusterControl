#!/bin/bash

VERSION="__VERSION__"

/bin/rm -f /usr/local/bin/kluster-cli
/bin/rm -f /usr/local/bin/kluster-agent
/bin/ln -s /usr/local/lib/kaveh-cluster-ctrl/bin/kluster-cli /usr/local/bin/kluster-cli
/bin/ln -s /usr/local/lib/kaveh-cluster-ctrl/bin/kluster-agent /usr/local/bin/kluster-agent
/bin/rm -f /lib/systemd/system/kaveh-cluster-ctrl.service
/bin/systemctl daemon-reload
/bin/cp -f /usr/local/lib/kaveh-cluster-ctrl/systemd/kaveh-cluster-ctrl.service /lib/systemd/system/
/bin/chmod +x /usr/local/lib/kaveh-cluster-ctrl/node/fixup.sh
/usr/local/lib/kaveh-cluster-ctrl/node/fixup.sh
/bin/chown root:root /usr/local/bin/kluster-cli
/bin/chown root:root /usr/local/bin/kluster-agent
/bin/chmod 755 /usr/local/bin/kluster-cli
/bin/chmod 755 /usr/local/bin/kluster-agent

systemctl daemon-reload

if [ -f /tmp/.kaveh-cluster-ctrl.conf.old ]; then
    rm -f /etc/kaveh-cluster-ctrl.conf
    mv -f /tmp/.kaveh-cluster-ctrl.conf.old /etc/kaveh-cluster-ctrl.conf
fi

if [ -f /tmp/.kaveh-cluster-ctrl-restart-service.cmd ]; then
    rm -f /tmp/.kaveh-cluster-ctrl-restart-service.cmd
    /bin/systemctl stop kaveh-cluster-ctrl.service
    /bin/systemctl restart kaveh-cluster-ctrl.service
fi

if [ -f /tmp/.kaveh-cluster-ctrl-enable-service.cmd ]; then
    rm -f /tmp/.kaveh-cluster-ctrl-enable-service.cmd
    /bin/systemctl enable kaveh-cluster-ctrl.service
fi

mkdir -p /usr/local/lib/kaveh-cluster-ctrl/targetcli-backup

rm -f /usr/local/lib/kaveh-cluster-ctrl/VERSION
echo "${VERSION}" > /usr/local/lib/kaveh-cluster-ctrl/VERSION


