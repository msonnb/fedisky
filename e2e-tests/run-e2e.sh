#!/bin/bash
#
# E2E Test Runner for Fedisky
#
# Prerequisites (one-time setup):
#   1. Add to /etc/hosts:
#      127.0.0.1 bsky.test mastodon.test
#   2. Docker (or Orbstack) installed and running
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
CA_CERT_FILE="/tmp/e2e-caddy-ca.crt"

# Track PIDs for cleanup
FEDISKY_PID=""
MOCKAP_PID=""

cleanup() {
  echo ""
  echo "Cleaning up..."
  
  # Kill native processes
  if [[ -n "$FEDISKY_PID" ]] && kill -0 "$FEDISKY_PID" 2>/dev/null; then
    echo "Stopping Fedisky (PID $FEDISKY_PID)"
    kill "$FEDISKY_PID" 2>/dev/null || true
  fi
  if [[ -n "$MOCKAP_PID" ]] && kill -0 "$MOCKAP_PID" 2>/dev/null; then
    echo "Stopping mock-ap (PID $MOCKAP_PID)"
    kill "$MOCKAP_PID" 2>/dev/null || true
  fi
  
  # Stop Docker services
  echo "Stopping Docker services..."
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
  
  # Clean up CA cert
  rm -f "$CA_CERT_FILE"
  
  echo "Cleanup complete"
}

# Set up trap for cleanup on exit
trap cleanup EXIT

echo "========================================"
echo "  Fedisky E2E Tests"
echo "========================================"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! grep -q "bsky.test" /etc/hosts 2>/dev/null; then
  echo "ERROR: Missing /etc/hosts entries"
  echo ""
  echo "Please add the following to /etc/hosts:"
  echo "  127.0.0.1 bsky.test mastodon.test"
  echo ""
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running"
  exit 1
fi

echo "Prerequisites OK"
echo ""

# Step 1: Stop any existing services
echo "Step 1: Cleaning up previous runs..."
docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true

# Step 2: Start Docker services (PDS + Caddy)
echo ""
echo "Step 2: Starting Docker services (PDS + Caddy)..."
docker compose -f "$COMPOSE_FILE" up -d --wait

# Step 3: Extract Caddy's CA certificate
echo ""
echo "Step 3: Extracting Caddy CA certificate..."

# Wait a moment for Caddy to generate its CA
sleep 2

# Try to extract the CA cert (retry a few times as Caddy may still be initializing)
for i in {1..10}; do
  if docker compose -f "$COMPOSE_FILE" exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$CA_CERT_FILE" 2>/dev/null; then
    if [[ -s "$CA_CERT_FILE" ]]; then
      echo "CA certificate extracted to $CA_CERT_FILE"
      break
    fi
  fi
  if [[ $i -eq 10 ]]; then
    echo "ERROR: Failed to extract Caddy CA certificate"
    exit 1
  fi
  echo "Waiting for Caddy to generate CA certificate (attempt $i/10)..."
  sleep 1
done

export NODE_EXTRA_CA_CERTS="$CA_CERT_FILE"

# Step 4: Build TypeScript
echo ""
echo "Step 4: Building TypeScript..."
cd "$PROJECT_DIR"
pnpm build

# Build mock-ap server
echo "Building mock-ap server..."
cd "$SCRIPT_DIR/mock-ap-server"
pnpm build
cd "$PROJECT_DIR"

# Step 5: Start Fedisky (native)
echo ""
echo "Step 5: Starting Fedisky..."

AP_HOSTNAME=bsky.test \
AP_PORT=2588 \
PDS_URL=http://localhost:3000 \
PDS_ADMIN_TOKEN=admin-password \
AP_DB_LOCATION=:memory: \
AP_FIREHOSE_ENABLED=true \
AP_BRIDGE_HANDLE=bridge.bsky.test \
AP_ALLOW_PRIVATE_ADDRESS=true \
LOG_ENABLED=true \
NODE_EXTRA_CA_CERTS="$CA_CERT_FILE" \
node "$SCRIPT_DIR/start-fedisky.js" &
FEDISKY_PID=$!

echo "Fedisky started (PID $FEDISKY_PID)"

# Step 6: Start mock-ap (native)
echo ""
echo "Step 6: Starting mock-ap server..."

AP_HOSTNAME=mastodon.test \
AP_PUBLIC_URL=https://mastodon.test \
AP_PORT=3001 \
AP_USERS=alice,bob,follower,reader,watcher,viewer,fan1,fan2,ufer \
NODE_EXTRA_CA_CERTS="$CA_CERT_FILE" \
node "$SCRIPT_DIR/mock-ap-server/dist/index.js" &
MOCKAP_PID=$!

echo "mock-ap started (PID $MOCKAP_PID)"

# Step 7: Wait for services to be ready
echo ""
echo "Step 7: Waiting for services to be ready..."

# Wait for Fedisky health
for i in {1..30}; do
  if curl -sf http://localhost:2588/health >/dev/null 2>&1; then
    echo "Fedisky is ready"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: Fedisky failed to start"
    exit 1
  fi
  sleep 1
done

# Wait for mock-ap health
for i in {1..30}; do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
    echo "mock-ap is ready"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: mock-ap failed to start"
    exit 1
  fi
  sleep 1
done

echo "All services are ready"

# Step 8: Run tests
echo ""
echo "Step 8: Running E2E tests..."
echo ""

cd "$PROJECT_DIR"
pnpm vitest run e2e-tests/*.e2e.test.ts
TEST_EXIT=$?

echo ""
if [[ $TEST_EXIT -eq 0 ]]; then
  echo "All E2E tests passed!"
else
  echo "Some E2E tests failed (exit code: $TEST_EXIT)"
fi

exit $TEST_EXIT
