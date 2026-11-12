#!/bin/sh
install_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$install_root/install.sh" --pause
