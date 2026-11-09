#!/bin/sh
# Starts Plugboard on Mac and Linux. Run by "Start Plugboard.command" (Mac) or directly (Linux).
cd "$(dirname "$0")" || exit 1

stop() {
  echo
  echo "$1"
  printf 'Press Enter to close this window. '
  read -r _
  exit 1
}

help_text="  1. Open https://nodejs.org in your web browser.
  2. Click the big green download button and run the installer.
  3. Double-click \"Start Plugboard\" again."

command -v node >/dev/null 2>&1 || stop "Plugboard needs a free program called Node.js, and it is not installed yet.
$help_text"

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)" ||
  stop "Your copy of Node.js is too old for Plugboard.
$help_text"

node src/cli.ts "$@" || stop 'Plugboard stopped. If you did not close it on purpose, see "Troubleshooting" in README.md.'
