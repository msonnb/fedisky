#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

# Disable prompts for apt-get.
export DEBIAN_FRONTEND="noninteractive"

# Configuration
PDS_DATADIR="/pds"
AP_DATADIR="/pds/activitypub"
AP_PORT="2588"
AP_DB_LOCATION="${AP_DATADIR}/activitypub.sqlite"

# Docker image for the ActivityPub sidecar
AP_IMAGE="ghcr.io/msonnb/fedisky:latest"

# PDS image (must match the original installer)
PDS_IMAGE="ghcr.io/bluesky-social/pds:latest"

function usage {
  local error="${1}"
  cat <<USAGE >&2
ERROR: ${error}

Usage:
  sudo bash $0

This script installs the ActivityPub federation sidecar alongside an
existing Bluesky PDS installation. The PDS must be installed first
using the official installer.

Please try again.
USAGE
  exit 1
}

function main {
  # Check that user is root.
  if [[ "${EUID}" -ne 0 ]]; then
    usage "This script must be run as root. (e.g. sudo $0)"
  fi

  echo "========================================"
  echo "  ActivityPub Sidecar Installer"
  echo "========================================"
  echo

  #
  # Check that PDS is installed
  #
  if ! [[ -f "${PDS_DATADIR}/pds.env" ]]; then
    usage "PDS is not installed. Please run the PDS installer first.

The PDS installer can be found at:
  https://github.com/bluesky-social/pds

Run it with:
  curl -fsSL https://raw.githubusercontent.com/bluesky-social/pds/main/installer.sh | sudo bash"
  fi

  echo "* Found existing PDS installation at ${PDS_DATADIR}"

  #
  # Check if ActivityPub sidecar is already installed
  #
  if [[ -f "${AP_DATADIR}/activitypub.env" ]]; then
    echo
    echo "WARNING: ActivityPub sidecar appears to be already installed."
    echo "         Configuration found at: ${AP_DATADIR}/activitypub.env"
    echo
    read -p "Do you want to reinstall? This will overwrite the configuration. (y/N): " REINSTALL_PROMPT
    if [[ ! "${REINSTALL_PROMPT}" =~ ^[Yy] ]]; then
      echo "Installation cancelled."
      exit 0
    fi
    echo
  fi

  #
  # Read PDS configuration
  #
  echo "* Reading PDS configuration..."

  # Source the PDS environment file to get variables
  set -a
  source "${PDS_DATADIR}/pds.env"
  set +a

  if [[ -z "${PDS_HOSTNAME:-}" ]]; then
    usage "PDS_HOSTNAME not found in ${PDS_DATADIR}/pds.env"
  fi

  if [[ -z "${PDS_ADMIN_PASSWORD:-}" ]]; then
    usage "PDS_ADMIN_PASSWORD not found in ${PDS_DATADIR}/pds.env"
  fi

  echo "  - PDS Hostname: ${PDS_HOSTNAME}"
  echo

  #
  # Prompt for ActivityPub-specific configuration
  #
  echo "---------------------------------------"
  echo "  ActivityPub Configuration"
  echo "---------------------------------------"
  echo
  echo "The ActivityPub sidecar enables federation with Mastodon, Pleroma,"
  echo "and other Fediverse servers."
  echo

  # Ask if they want to use a different hostname for ActivityPub
  AP_HOSTNAME="${PDS_HOSTNAME}"
  read -p "Use '${PDS_HOSTNAME}' as the ActivityPub hostname? (Y/n): " USE_PDS_HOSTNAME
  if [[ "${USE_PDS_HOSTNAME}" =~ ^[Nn] ]]; then
    read -p "Enter the ActivityPub hostname (e.g. ap.example.com): " AP_HOSTNAME
    if [[ -z "${AP_HOSTNAME}" ]]; then
      AP_HOSTNAME="${PDS_HOSTNAME}"
      echo "  Using default: ${AP_HOSTNAME}"
    fi
  fi
  echo

  # Ask about firehose subscription
  AP_FIREHOSE_ENABLED="true"
  echo "The firehose subscription allows the sidecar to automatically"
  echo "federate new posts to ActivityPub followers in real-time."
  echo
  read -p "Enable firehose subscription for real-time federation? (Y/n): " ENABLE_FIREHOSE
  if [[ "${ENABLE_FIREHOSE}" =~ ^[Nn] ]]; then
    AP_FIREHOSE_ENABLED="false"
  fi
  echo

  # Mastodon bridge account configuration
  AP_MASTODON_BRIDGE_HANDLE="mastodon.${PDS_HOSTNAME}"
  AP_MASTODON_BRIDGE_DISPLAY_NAME="Mastodon Bridge"
  AP_MASTODON_BRIDGE_DESCRIPTION="This account posts content from Mastodon and other Fediverse servers."

  echo "The sidecar creates a 'mastodon bridge account' on your PDS to post incoming"
  echo "replies from Mastodon users. The default handle is: mastodon.${PDS_HOSTNAME}"
  echo
  read -p "Use a custom mastodon bridge account handle? (y/N): " CUSTOM_BRIDGE
  if [[ "${CUSTOM_BRIDGE}" =~ ^[Yy] ]]; then
    read -p "Enter mastodon bridge account handle (e.g. fediverse.${PDS_HOSTNAME}): " AP_MASTODON_BRIDGE_HANDLE
    if [[ -z "${AP_MASTODON_BRIDGE_HANDLE}" ]]; then
      AP_MASTODON_BRIDGE_HANDLE="mastodon.${PDS_HOSTNAME}"
      echo "  Using default: ${AP_MASTODON_BRIDGE_HANDLE}"
    fi
    read -p "Enter mastodon bridge account display name (default: Mastodon Bridge): " AP_MASTODON_BRIDGE_DISPLAY_NAME
    if [[ -z "${AP_MASTODON_BRIDGE_DISPLAY_NAME}" ]]; then
      AP_MASTODON_BRIDGE_DISPLAY_NAME="Mastodon Bridge"
    fi
  fi
  echo

  #
  # Check Docker is available
  #
  if ! docker version >/dev/null 2>&1; then
    usage "Docker is not installed or not running. Please ensure the PDS is properly installed."
  fi

  #
  # Create ActivityPub data directory
  #
  if ! [[ -d "${AP_DATADIR}" ]]; then
    echo "* Creating ActivityPub data directory ${AP_DATADIR}"
    mkdir --parents "${AP_DATADIR}"
  fi
  chmod 700 "${AP_DATADIR}"

  #
  # Create the ActivityPub env config
  #
  echo "* Creating ActivityPub configuration..."

  cat <<AP_CONFIG >"${AP_DATADIR}/activitypub.env"
# ActivityPub Federation Sidecar Configuration
# Generated by fedisky-installer.sh on $(date -Iseconds)

# Service configuration
AP_PORT=${AP_PORT}
AP_HOSTNAME=${AP_HOSTNAME}
AP_VERSION=0.0.1

# PDS connection (reusing PDS credentials)
PDS_URL=http://localhost:3000
PDS_ADMIN_TOKEN=${PDS_ADMIN_PASSWORD}
PDS_HOSTNAME=${PDS_HOSTNAME}

# Database
AP_DB_LOCATION=/data/activitypub.sqlite

# Firehose subscription
AP_FIREHOSE_ENABLED=${AP_FIREHOSE_ENABLED}

# Mastodon bridge account (auto-created on startup)
AP_MASTODON_BRIDGE_HANDLE=${AP_MASTODON_BRIDGE_HANDLE}
AP_MASTODON_BRIDGE_DISPLAY_NAME=${AP_MASTODON_BRIDGE_DISPLAY_NAME}
AP_MASTODON_BRIDGE_DESCRIPTION=${AP_MASTODON_BRIDGE_DESCRIPTION}

# Logging
LOG_ENABLED=true
AP_CONFIG

  echo "  Configuration saved to ${AP_DATADIR}/activitypub.env"

  #
  # Update Caddy configuration to route ActivityPub traffic
  #
  echo "* Updating Caddy configuration..."

  CADDYFILE="${PDS_DATADIR}/caddy/etc/caddy/Caddyfile"

  # Backup existing Caddyfile
  if [[ -f "${CADDYFILE}" ]]; then
    cp "${CADDYFILE}" "${CADDYFILE}.backup.$(date +%Y%m%d%H%M%S)"
  fi

  # Read the admin email from existing Caddyfile or use a default
  ADMIN_EMAIL=$(grep -oP '^\s*email\s+\K[^\s]+' "${CADDYFILE}" 2>/dev/null || echo "admin@${PDS_HOSTNAME}")

  # Build the Caddyfile content
  # When AP_HOSTNAME differs from PDS_HOSTNAME, we add a separate site block for it
  if [[ "${AP_HOSTNAME}" != "${PDS_HOSTNAME}" ]]; then
    AP_SITE_BLOCK="
${AP_HOSTNAME} {
	import activitypub_routes
	# Return 404 for non-ActivityPub requests on this hostname
	handle {
		respond \"Not Found\" 404
	}
}
"
	PDS_SITE_BLOCK="
${PDS_HOSTNAME}, *.${PDS_HOSTNAME} {
	tls {
		on_demand
	}

	reverse_proxy http://localhost:3000
}
"
  else
    AP_SITE_BLOCK=""
		PDS_SITE_BLOCK="
${PDS_HOSTNAME}, *.${PDS_HOSTNAME} {
	tls {
		on_demand
	}

	import activitypub_routes

	handle {
		reverse_proxy http://localhost:3000
	}
}
"
  fi

  cat <<CADDYFILE_CONTENT >"${CADDYFILE}"
{
	email ${ADMIN_EMAIL}
	on_demand_tls {
		ask http://localhost:3000/tls-check
	}
}

# Snippet for ActivityPub routing to sidecar
(activitypub_routes) {
	@activitypub {
		path /users/* /posts/* /.well-known/webfinger* /.well-known/nodeinfo* /nodeinfo/* /inbox
	}
	handle @activitypub {
		reverse_proxy http://localhost:${AP_PORT} {
			header_up X-Forwarded-Proto {scheme}
			header_up X-Forwarded-Host {host}
		}
	}

	@activitypub_accept {
		header Accept *application/activity+json*
		not path /xrpc/*
	}
	handle @activitypub_accept {
		reverse_proxy http://localhost:${AP_PORT} {
			header_up X-Forwarded-Proto {scheme}
			header_up X-Forwarded-Host {host}
		}
	}
}
${AP_SITE_BLOCK}
${PDS_SITE_BLOCK}
CADDYFILE_CONTENT

  echo "  Caddyfile updated with ActivityPub routing"

  #
  # Update Docker Compose file to include ActivityPub service
  #
  echo "* Updating Docker Compose configuration..."

  COMPOSE_FILE="${PDS_DATADIR}/compose.yaml"

  # Backup existing compose file
  if [[ -f "${COMPOSE_FILE}" ]]; then
    cp "${COMPOSE_FILE}" "${COMPOSE_FILE}.backup.$(date +%Y%m%d%H%M%S)"
  fi

  # Check if activitypub service already exists in compose file
  if grep -q "activitypub:" "${COMPOSE_FILE}" 2>/dev/null; then
    echo "  ActivityPub service already exists in compose file, updating..."
    # Remove existing activitypub service block (simplified approach: regenerate)
  fi

  # Generate new compose file preserving original structure with ActivityPub added
  cat <<COMPOSE_CONTENT >"${COMPOSE_FILE}"
services:
  caddy:
    container_name: caddy
    image: caddy:2
    network_mode: host
    depends_on:
      - pds
      - activitypub
    restart: unless-stopped
    volumes:
      - type: bind
        source: ${PDS_DATADIR}/caddy/data
        target: /data
      - type: bind
        source: ${PDS_DATADIR}/caddy/etc/caddy
        target: /etc/caddy
  pds:
    container_name: pds
    image: ${PDS_IMAGE}
    network_mode: host
    restart: unless-stopped
    volumes:
      - type: bind
        source: ${PDS_DATADIR}
        target: ${PDS_DATADIR}
    env_file:
      - ${PDS_DATADIR}/pds.env
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:3000/xrpc/_health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
  activitypub:
    container_name: activitypub
    image: ${AP_IMAGE}
    network_mode: host
    restart: unless-stopped
    depends_on:
      pds:
        condition: service_healthy
        restart: true
    volumes:
      - type: bind
        source: ${AP_DATADIR}
        target: /data
    env_file:
      - ${AP_DATADIR}/activitypub.env
  watchtower:
    container_name: watchtower
    image: ghcr.io/nicholas-fedor/watchtower:latest
    network_mode: host
    volumes:
      - type: bind
        source: /var/run/docker.sock
        target: /var/run/docker.sock
    restart: unless-stopped
    environment:
      WATCHTOWER_CLEANUP: true
      WATCHTOWER_SCHEDULE: '@midnight'
COMPOSE_CONTENT

  echo "  Docker Compose updated with ActivityPub service"

  #
  # Create/update systemd service
  #
  echo "* Updating systemd service..."

  cat <<SYSTEMD_UNIT_FILE >/etc/systemd/system/pds.service
[Unit]
Description=Bluesky PDS Service with ActivityPub Federation
Documentation=https://github.com/bluesky-social/pds
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${PDS_DATADIR}
ExecStart=/usr/bin/docker compose --file ${PDS_DATADIR}/compose.yaml up --detach
ExecStop=/usr/bin/docker compose --file ${PDS_DATADIR}/compose.yaml down

[Install]
WantedBy=default.target
SYSTEMD_UNIT_FILE

  systemctl daemon-reload

  #
  # Restart services
  #
  echo "* Restarting services..."
  systemctl restart pds

  # Wait for services to start
  echo "* Waiting for services to start..."
  sleep 5

  # Check if services are running
  if docker ps | grep -q "activitypub"; then
    echo "  ActivityPub service is running"
  else
    echo "  WARNING: ActivityPub service may not be running yet"
    echo "           Check with: docker ps"
  fi

  #
  # Print success message
  #
  cat <<INSTALLER_MESSAGE

========================================================================
ActivityPub Sidecar Installation Complete!
------------------------------------------------------------------------

Configuration
------------------------------------------------------------------------
PDS Hostname:         ${PDS_HOSTNAME}
ActivityPub Hostname: ${AP_HOSTNAME}
ActivityPub Port:     ${AP_PORT}
Firehose Enabled:     ${AP_FIREHOSE_ENABLED}
Data Directory:       ${AP_DATADIR}

Service Management
------------------------------------------------------------------------
Check service status  : sudo systemctl status pds
View PDS logs         : sudo docker logs -f pds
View ActivityPub logs : sudo docker logs -f activitypub
Restart services      : sudo systemctl restart pds

Bridge Account
------------------------------------------------------------------------
The ActivityPub sidecar automatically creates a "mastodon" bridge account
on your PDS. This account is used to post replies from Mastodon and other
Fediverse users. The bridge account is hidden from ActivityPub federation
and won't be discoverable from the Fediverse.

Bridge handle         : ${AP_MASTODON_BRIDGE_HANDLE}
Bridge display name   : ${AP_MASTODON_BRIDGE_DISPLAY_NAME}

ActivityPub Endpoints
------------------------------------------------------------------------
WebFinger             : https://${AP_HOSTNAME}/.well-known/webfinger
NodeInfo              : https://${AP_HOSTNAME}/.well-known/nodeinfo
User profiles         : https://${AP_HOSTNAME}/users/{handle}

Testing
------------------------------------------------------------------------
To test WebFinger resolution for a user (replace 'alice' with actual handle):

  curl "https://${AP_HOSTNAME}/.well-known/webfinger?resource=acct:alice@${AP_HOSTNAME}"

To search for your PDS users from Mastodon:
  Search for @username@${AP_HOSTNAME}

Configuration Files
------------------------------------------------------------------------
ActivityPub config    : ${AP_DATADIR}/activitypub.env
Caddy config          : ${PDS_DATADIR}/caddy/etc/caddy/Caddyfile
Docker Compose        : ${PDS_DATADIR}/compose.yaml

========================================================================
INSTALLER_MESSAGE

  #
  # Optional: Test the installation
  #
  read -p "Would you like to test the ActivityPub endpoints? (y/N): " TEST_PROMPT
  if [[ "${TEST_PROMPT}" =~ ^[Yy] ]]; then
    echo
    echo "Testing ActivityPub endpoints..."
    echo

    # Test NodeInfo
    echo "* Testing NodeInfo endpoint..."
    NODEINFO_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${AP_PORT}/nodeinfo/2.1" 2>/dev/null || echo "failed")
    if [[ "${NODEINFO_RESPONSE}" == "200" ]]; then
      echo "  NodeInfo: OK (HTTP 200)"
    else
      echo "  NodeInfo: Response code ${NODEINFO_RESPONSE} (may need a moment to start)"
    fi

    # Test WebFinger (will likely return 404 without a valid user, but that's okay)
    echo "* Testing WebFinger endpoint..."
    WEBFINGER_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${AP_PORT}/.well-known/webfinger?resource=acct:test@${AP_HOSTNAME}" 2>/dev/null || echo "failed")
    if [[ "${WEBFINGER_RESPONSE}" == "200" ]] || [[ "${WEBFINGER_RESPONSE}" == "404" ]]; then
      echo "  WebFinger: OK (HTTP ${WEBFINGER_RESPONSE})"
    else
      echo "  WebFinger: Response code ${WEBFINGER_RESPONSE}"
    fi

    echo
    echo "Note: Full testing requires valid user accounts on the PDS."
    echo "Create accounts with: pdsadmin account create"
  fi

  echo
  echo "Installation complete!"
}

# Run main function.
main
