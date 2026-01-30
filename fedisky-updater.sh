#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

# Configuration
PDS_DATADIR="/pds"
AP_DATADIR="/pds/activitypub"
AP_IMAGE="ghcr.io/msonnb/fedisky:latest"

function usage {
  local error="${1}"
  cat <<USAGE >&2
ERROR: ${error}

Usage:
  sudo bash $0 [options]

Options:
  --force       Force update even if already on latest version
  --no-restart  Pull new image but don't restart services
  --help        Show this help message

This script updates the Fedisky ActivityPub sidecar to the newest version.
The sidecar must be installed first using fedisky-installer.sh.

Please try again.
USAGE
  exit 1
}

function print_header {
  echo "========================================"
  echo "  Fedisky Updater"
  echo "========================================"
  echo
}

function check_root {
  if [[ "${EUID}" -ne 0 ]]; then
    usage "This script must be run as root. (e.g. sudo $0)"
  fi
}

function check_installation {
  if ! [[ -f "${AP_DATADIR}/activitypub.env" ]]; then
    usage "Fedisky is not installed. Please run fedisky-installer.sh first.

The installer can be found at:
  https://github.com/msonnb/fedisky

Run it with:
  curl -fsSL https://raw.githubusercontent.com/msonnb/fedisky/main/fedisky-installer.sh | sudo bash"
  fi

  if ! [[ -f "${PDS_DATADIR}/compose.yaml" ]]; then
    usage "Docker Compose configuration not found at ${PDS_DATADIR}/compose.yaml"
  fi

  echo "* Found existing Fedisky installation at ${AP_DATADIR}"
}

function check_docker {
  if ! docker version >/dev/null 2>&1; then
    usage "Docker is not installed or not running."
  fi
}

function get_current_version {
  # Get the current running image digest
  local current_digest
  current_digest=$(docker inspect activitypub --format='{{index .RepoDigests 0}}' 2>/dev/null || echo "unknown")
  echo "${current_digest}"
}

function get_remote_version {
  # Pull the latest image and get its digest
  echo "* Checking for updates..."
  docker pull "${AP_IMAGE}" --quiet >/dev/null 2>&1 || true
  
  local remote_digest
  remote_digest=$(docker inspect "${AP_IMAGE}" --format='{{index .RepoDigests 0}}' 2>/dev/null || echo "unknown")
  echo "${remote_digest}"
}

function backup_config {
  local backup_dir="${AP_DATADIR}/backups"
  local timestamp
  timestamp=$(date +%Y%m%d%H%M%S)
  
  echo "* Creating configuration backup..."
  
  if ! [[ -d "${backup_dir}" ]]; then
    mkdir --parents "${backup_dir}"
  fi
  
  # Backup env file
  if [[ -f "${AP_DATADIR}/activitypub.env" ]]; then
    cp "${AP_DATADIR}/activitypub.env" "${backup_dir}/activitypub.env.${timestamp}"
    echo "  - Backed up activitypub.env"
  fi
  
  # Backup compose file
  if [[ -f "${PDS_DATADIR}/compose.yaml" ]]; then
    cp "${PDS_DATADIR}/compose.yaml" "${backup_dir}/compose.yaml.${timestamp}"
    echo "  - Backed up compose.yaml"
  fi
  
  # Clean up old backups (keep last 5)
  echo "* Cleaning up old backups..."
  find "${backup_dir}" -name "*.env.*" -type f | sort -r | tail -n +6 | xargs -r rm -f
  find "${backup_dir}" -name "*.yaml.*" -type f | sort -r | tail -n +6 | xargs -r rm -f
}

function pull_latest_image {
  echo "* Pulling latest Fedisky image..."
  if docker pull "${AP_IMAGE}"; then
    echo "  Image pulled successfully"
  else
    echo "  ERROR: Failed to pull image"
    exit 1
  fi
}

function restart_services {
  echo "* Stopping ActivityPub service..."
  docker compose --file "${PDS_DATADIR}/compose.yaml" stop activitypub 2>/dev/null || true
  
  echo "* Removing old container..."
  docker compose --file "${PDS_DATADIR}/compose.yaml" rm -f activitypub 2>/dev/null || true
  
  echo "* Starting ActivityPub service with new image..."
  docker compose --file "${PDS_DATADIR}/compose.yaml" up -d activitypub
  
  # Wait for service to start
  echo "* Waiting for service to start..."
  sleep 5
  
  # Check if service is running
  if docker ps | grep -q "activitypub"; then
    echo "  ActivityPub service is running"
  else
    echo "  WARNING: ActivityPub service may not be running"
    echo "           Check with: docker ps"
    echo "           View logs with: docker logs activitypub"
  fi
}

function cleanup_old_images {
  echo "* Cleaning up old Docker images..."
  docker image prune -f --filter "label=org.opencontainers.image.source=https://github.com/msonnb/fedisky" 2>/dev/null || true
  # Also try generic prune for dangling images
  docker image prune -f 2>/dev/null || true
  echo "  Cleanup complete"
}

function print_success {
  local new_digest="${1}"
  
  cat <<SUCCESS_MESSAGE

========================================================================
Fedisky Update Complete!
------------------------------------------------------------------------

The ActivityPub sidecar has been updated to the latest version.

Current Image: ${AP_IMAGE}
Image Digest:  ${new_digest}

Service Management
------------------------------------------------------------------------
Check service status  : sudo systemctl status pds
View ActivityPub logs : sudo docker logs -f activitypub
Restart services      : sudo systemctl restart pds

If you experience any issues after the update, you can restore
the previous configuration from: ${AP_DATADIR}/backups/

========================================================================
SUCCESS_MESSAGE
}

function main {
  local force_update=false
  local no_restart=false
  
  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "${1}" in
      --force)
        force_update=true
        shift
        ;;
      --no-restart)
        no_restart=true
        shift
        ;;
      --help)
        usage "Showing help"
        ;;
      *)
        usage "Unknown option: ${1}"
        ;;
    esac
  done
  
  print_header
  check_root
  check_installation
  check_docker
  
  # Get current version
  local current_digest
  current_digest=$(get_current_version)
  echo "  Current image: ${current_digest}"
  echo
  
  # Backup configuration before update
  backup_config
  echo
  
  # Pull the latest image
  pull_latest_image
  
  # Get new version info
  local new_digest
  new_digest=$(docker inspect "${AP_IMAGE}" --format='{{index .RepoDigests 0}}' 2>/dev/null || echo "unknown")
  
  # Check if update is needed
  if [[ "${current_digest}" == "${new_digest}" ]] && [[ "${force_update}" == "false" ]]; then
    echo
    echo "* Already running the latest version!"
    echo "  Use --force to restart with the same version."
    echo
    exit 0
  fi
  
  if [[ "${current_digest}" != "${new_digest}" ]]; then
    echo "  New version available!"
    echo "  New image: ${new_digest}"
  fi
  echo
  
  # Restart services unless --no-restart was specified
  if [[ "${no_restart}" == "false" ]]; then
    restart_services
    echo
    
    cleanup_old_images
    echo
    
    print_success "${new_digest}"
  else
    echo "* Skipping service restart (--no-restart specified)"
    echo "  To apply the update, run: sudo systemctl restart pds"
    echo
  fi
  
  echo "Update complete!"
}

# Run main function with all arguments
main "$@"
