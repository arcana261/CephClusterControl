#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "cleaning up old files..."

rm -rf "${DIR}/SOURCE"
rm -rf "${DIR}/SPEC"
mkdir -p "${DIR}/SOURCE"
mkdir -p "${DIR}/SPEC"
mkdir -p ~/rpmbuild/{SOURCES,SPEC}

PACKAGE="$(eval node '${DIR}/../read-json.js' 'name' '${DIR}/../../package.json')"
VERSION="$(eval node '${DIR}/../read-json.js' 'version' '${DIR}/../../package.json')"
MAINTAINER="$(eval node '${DIR}/../read-json.js' 'author' '${DIR}/../../package.json')"
DESCRIPTION="$(eval node '${DIR}/../read-json.js' 'description' '${DIR}/../../package.json')"

echo "creating source directory structure..."

mkdir -p "${DIR}/SOURCE/${PACKAGE}-${VERSION}"
cp -rf "${DIR}/../../bin" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -rf "${DIR}/../../config" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -rf "${DIR}/../../etc" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -rf "${DIR}/../../lib" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -rf "${DIR}/../../node" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -rf "${DIR}/../../node_modules" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -rf "${DIR}/../../systemd" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -f "${DIR}/../../client.js" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -f "${DIR}/../../server.js" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -f "${DIR}/../../package.json" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -f "${DIR}/../../package-lock.json" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"
cp -f "${DIR}/../../README.md" "${DIR}/SOURCE/${PACKAGE}-${VERSION}/"

echo "creating source tarball..."

pushd "${DIR}/SOURCE"
tar czf "${PACKAGE}-${VERSION}.tar.gz" "${PACKAGE}-${VERSION}/"
popd

rm -f "~/rpmbuild/SOURCES/${PACKAGE}-${VERSION}.tar.gz"
mv -f "${DIR}"/SOURCE/${PACKAGE}-${VERSION}.tar.gz ~/rpmbuild/SOURCES/"${PACKAGE}-${VERSION}.tar.gz"

echo "creating spec file..."

SPEC_FILE="${DIR}/SPEC/${PACKAGE}.spec"

echo "Name: ${PACKAGE}" >> "${SPEC_FILE}"
echo "Version: ${VERSION}" >> "${SPEC_FILE}"
echo "Release: 1%{?dist}" >> "${SPEC_FILE}"
echo "Summary: ${DESCRIPTION}" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "Group: Test Packages" >> "${SPEC_FILE}"
echo "License: GPL" >> "${SPEC_FILE}"
echo "URL: https://keloud.ir" >> "${SPEC_FILE}"
echo "Source0: %{name}-%{version}.tar.gz" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "BuildRequires: /bin/rm, /bin/mkdir, /bin/cp" >> "${SPEC_FILE}"
echo "Requires: /bin/bash, /bin/date" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "%description" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "${DESCRIPTION}" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "%prep" >> "${SPEC_FILE}"
echo "%setup -q" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "%build" >> "${SPEC_FILE}"
echo "#configure" >> "${SPEC_FILE}"
echo "# make %{?_smp_mflags}" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "%install" >> "${SPEC_FILE}"
echo "# make install DESTDIR=%{buildroot}" >> "${SPEC_FILE}"
cat "${DIR}/lib/install.sh" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "%files" >> "${SPEC_FILE}"
echo "%defattr(_, root, root)" >> "${SPEC_FILE}"
echo "%attr(755, root, root) %{buildroot}/usr/local/bin/kluster-agent"
echo "%attr(755, root, root) %{buildroot}/usr/local/bin/kluster-cli"
echo "#doc" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "%post" >> "${SPEC_FILE}"
cat "${DIR}/../deb/lib/postinst.sh" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "%postun" >> "${SPEC_FILE}"
cat "${DIR}/../deb/lib/postrm.sh" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "%pre" >> "${SPEC_FILE}"
cat "${DIR}/../deb/lib/preinst.sh" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "%preun" >> "${SPEC_FILE}"
cat "${DIR}/../deb/lib/prerm.sh" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"
echo "%changelog" >> "${SPEC_FILE}"
echo "" >> "${SPEC_FILE}"








