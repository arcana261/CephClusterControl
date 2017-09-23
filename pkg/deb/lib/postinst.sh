#!/bin/bash

/bin/chmod +x /usr/local/lib/kaveh-cluster-ctrl/node/fixup.sh
/usr/local/lib/kaveh-cluster-ctrl/node/fixup.sh
/bin/chmod +x /usr/local/bin/kluster-cli
/bin/chmod +x /usr/local/bin/kluster-agent

rm -rf /var/lib/kaveh-cluster-ctrl/cluster.db

systemctl daemon-reload
