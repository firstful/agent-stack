podman() {
  if [ "$1" = "build" ]; then
    shift
    command podman build --cpu-quota=200000 --cpu-period=100000 --memory 4g "$@"
  else
    command podman "$@"
  fi
}
