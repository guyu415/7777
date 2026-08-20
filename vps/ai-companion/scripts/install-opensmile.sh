#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${AI_COMPANION_OPENSMILE_DIR:-/opt/ai-companion/models/opensmile}"
ARCHIVE_URL="https://github.com/audeering/opensmile/releases/download/v3.0.2/opensmile-3.0.2-linux-x86_64.zip"
ARCHIVE_SHA256="416da04a28fde4c7a3fc624bc7aa49901870e39b365b4c64e04e9923564938b9"

if [[ -x "$INSTALL_DIR/bin/SMILExtract" \
  && -f "$INSTALL_DIR/config/egemaps/v02/eGeMAPSv02.conf" \
  && -f "$INSTALL_DIR/config/shared/standard_wave_input.conf.inc" ]]; then
  printf 'openSMILE already installed: %s\n' "$INSTALL_DIR"
  exit 0
fi

work_dir="$(mktemp -d)"
cleanup() { find "$work_dir" -depth -delete 2>/dev/null || true; }
trap cleanup EXIT

curl -fL --retry 3 --max-time 180 "$ARCHIVE_URL" -o "$work_dir/opensmile.zip"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$work_dir/opensmile.zip" | sha256sum -c -
unzip -q "$work_dir/opensmile.zip" -d "$work_dir"
source_dir="$work_dir/opensmile-3.0.2-linux-x86_64"
[[ -x "$source_dir/bin/SMILExtract" ]]
[[ -f "$source_dir/config/egemaps/v02/eGeMAPSv02.conf" ]]

mkdir -p "$INSTALL_DIR"
cp -a "$source_dir/." "$INSTALL_DIR/"
printf 'openSMILE installed: %s\n' "$INSTALL_DIR"
