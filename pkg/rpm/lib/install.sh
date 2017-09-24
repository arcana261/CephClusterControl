
rm -rf %{buildroot}
mkdir -p %{buildroot}

mkdir -p %{buildroot}/var/lib/kaveh-cluster-ctrl
mkdir -p %{buildroot}/usr/local/bin
mkdir -p %{buildroot}/usr/local/lib/kaveh-cluster-ctrl
mkdir -p %{buildroot}/lib/systemd/system

cp -rf etc %{buildroot}/
cp -rf node %{buildroot}/usr/local/lib/kaveh-cluster-ctrl/
cp -rf lib %{buildroot}/usr/local/lib/kaveh-cluster-ctrl/
cp -rf config %{buildroot}/usr/local/lib/kaveh-cluster-ctrl/
cp -f server.js %{buildroot}/usr/local/lib/kaveh-cluster-ctrl/
cp -f client.js %{buildroot}/usr/local/lib/kaveh-cluster-ctrl/
cp -f README.md %{buildroot}/usr/local/lib/kaveh-cluster-ctrl/
cp -f package.json %{buildroot}/usr/local/lib/kaveh-cluster-ctrl/
cp -f package-lock.json %{buildroot}/usr/local/lib/kaveh-cluster-ctrl/
cp -rf node_modules %{buildroot}/usr/local/lib/kaveh-cluster-ctrl/
cp -rf bin %{buildroot}/usr/local/
cp -f systemd/kaveh-cluster-ctrl.service %{buildroot}/lib/systemd/system/


