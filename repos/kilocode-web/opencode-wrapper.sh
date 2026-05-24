#!/bin/sh
case "$1" in
  serve)
    shift
    exec kilo serve "$@"
    ;;
  --version|-v)
    kilo --version
    ;;
  upgrade)
    npm install -g @kilocode/cli@latest >/dev/null 2>&1
    echo "ok"
    ;;
  *)
    exec kilo "$@"
    ;;
esac
