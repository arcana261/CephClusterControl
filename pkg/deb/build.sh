#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

rm -rf "${DIR}/BUILD"
rm -f "${DIR}/BUILD.deb"

PACKAGE="$(eval node '${DIR}/../read-json.js' 'name' '${DIR}/../../package.json')"
VERSION="$(eval node '${DIR}/../read-json.js' 'version' '${DIR}/../../package.json')"
MAINTAINER="$(eval node '${DIR}/../read-json.js' 'author' '${DIR}/../../package.json')"
DESCRIPTION="$(eval node '${DIR}/../read-json.js' 'description' '${DIR}/../../package.json')"

rm -f "${DIR}/${PACKAGE}.deb"
rm -f "${DIR}/${PACKAGE}-${VERSION}.deb"
rm -f "${DIR}/${PACKAGE}-latest.deb"

mkdir -p "${DIR}/BUILD/DEBIAN"
mkdir -p "${DIR}/BUILD/var/lib/kaveh-cluster-ctrl"
mkdir -p "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl"

cp -rf "${DIR}/../../etc" "${DIR}/BUILD/"
cp -rf "${DIR}/../../node" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -rf "${DIR}/../../lib" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -rf "${DIR}/../../config" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -f "${DIR}/../../client.js" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -f "${DIR}/../../server.js" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -f "${DIR}/../../README.md" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -f "${DIR}/../../package.json" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -f "${DIR}/../../package-lock.json" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -rf "${DIR}/../../node_modules" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -rf "${DIR}/../../bin" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -rf "${DIR}/../../systemd" "${DIR}/BUILD/usr/local/lib/kaveh-cluster-ctrl/"
cp -f "${DIR}/lib/postinst.sh" "${DIR}/BUILD/DEBIAN/postinst"
cp -f "${DIR}/lib/preinst.sh" "${DIR}/BUILD/DEBIAN/preinst"
cp -f "${DIR}/lib/prerm.sh" "${DIR}/BUILD/DEBIAN/prerm"
cp -f "${DIR}/lib/postrm.sh" "${DIR}/BUILD/DEBIAN/postrm"
chmod +x "${DIR}/BUILD/DEBIAN/postinst"
chmod +x "${DIR}/BUILD/DEBIAN/preinst"
chmod +x "${DIR}/BUILD/DEBIAN/prerm"
chmod +x "${DIR}/BUILD/DEBIAN/postrm"

echo "Package: ${PACKAGE}" >> "${DIR}/BUILD/DEBIAN/control"
echo "Version: ${VERSION}" >> "${DIR}/BUILD/DEBIAN/control"
echo "Maintainer: ${MAINTAINER}" >> "${DIR}/BUILD/DEBIAN/control"
echo "Architecture: amd64" >> "${DIR}/BUILD/DEBIAN/control"
echo "Description: ${DESCRIPTION}" >> "${DIR}/BUILD/DEBIAN/control"

dpkg-deb --build "${DIR}/BUILD"

mv "${DIR}/BUILD.deb" "${DIR}/${PACKAGE}.deb"
cp -f "${DIR}/${PACKAGE}.deb" "${DIR}/${PACKAGE}-${VERSION}.deb"
cp -f "${DIR}/${PACKAGE}.deb" "${DIR}/${PACKAGE}-latest.deb"

