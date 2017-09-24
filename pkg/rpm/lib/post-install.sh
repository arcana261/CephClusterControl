
/bin/chmod +x /usr/local/lib/kaveh-cluster-ctrl/node/fixup.sh
/usr/local/lib/kaveh-cluster-ctrl/node/fixup.sh
/bin/chown root:root /usr/local/bin/kluster-cli
/bin/chown root:root /usr/local/bin/kluster-agent
/bin/chmod 755 /usr/local/bin/kluster-cli
/bin/chmod 755 /usr/local/bin/kluster-agent

rm -rf /var/lib/kaveh-cluster-ctrl/cluster.db

systemctl daemon-reload
