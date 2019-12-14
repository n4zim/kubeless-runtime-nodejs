#!/bin/sh

set -e

case "$1" in

  install)
    cd $KUBELESS_INSTALL_VOLUME
    yarn install --production
    ;;

  start)
    node /runtime/dist
    ping dropin.recipes
    ;;

  *)
    echo "Command not found"
    exit 1

esac
