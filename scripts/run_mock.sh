#!/usr/bin/env bash
# Run build_mock_video.py using project venv (create/install if needed).
# Usage: ./scripts/run_mock.sh [args...]
# Example: ./scripts/run_mock.sh project.zip -o out.mp4

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$REPO_ROOT/.venv"

if [[ ! -d "$VENV" ]]; then
  echo "Creating .venv and installing dependencies..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r "$REPO_ROOT/scripts/requirements-mock.txt"
fi

exec "$VENV/bin/python" "$REPO_ROOT/scripts/build_mock_video.py" "$@"
