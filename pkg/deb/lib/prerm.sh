#!/bin/bash

systemctl stop kaveh-cluster-ctrl.service
systemctl disable kaveh-cluster-ctrl.service
rm -rf /var/lib/kaveh-cluster-ctrl/cluster.db

