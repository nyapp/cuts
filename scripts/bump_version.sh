#!/usr/bin/env bash
# Bump the CUTS app version in every place it appears.
#   ./scripts/bump_version.sh 1.2.0
# Updates: js/00_version.js (CUTS_APP_VERSION) and the ?v= cache-busting
# query on every local <script>/<link> in index.html.
set -euo pipefail
v="${1:-}"
if [[ ! "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 X.Y.Z" >&2; exit 1
fi
root="$(cd "$(dirname "$0")/.." && pwd)"
sed -i.bak -E "s/(const CUTS_APP_VERSION = ')[^']*(')/\1${v}\2/" "$root/js/00_version.js"
sed -i.bak -E "s/((href|src)=\"(css|js)\/[^\"?]+)(\?v=[^\"]*)?\"/\1?v=${v}\"/g" "$root/index.html"
rm -f "$root/js/00_version.js.bak" "$root/index.html.bak"
grep -n "CUTS_APP_VERSION = " "$root/js/00_version.js"
grep -c "?v=${v}\"" "$root/index.html" | sed 's/$/ asset tags now carry ?v='"$v"'/'
