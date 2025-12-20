#!/bin/bash

# Script to create a test post for the alice user in the dev environment.
#
# Usage:
#   ./packages/dev-env/scripts/create-test-post.sh
#   ./packages/dev-env/scripts/create-test-post.sh "My custom post text"
#
# Requires the dev environment to be running (make run-dev-env-logged)

set -e

PDS_URL="http://localhost:2583"
ALICE_HANDLE="alice.test"
ALICE_PASSWORD="hunter2"

POST_TEXT="${1:-Test post created at $(date -u +"%Y-%m-%dT%H:%M:%SZ")}"

# Helper function to extract JSON field (uses jq if available, falls back to grep)
json_field() {
  local json="$1"
  local field="$2"
  if command -v jq &> /dev/null; then
    echo "$json" | jq -r ".$field"
  else
    echo "$json" | grep -o "\"$field\":\"[^\"]*" | head -1 | cut -d'"' -f4
  fi
}

echo "Connecting to PDS at $PDS_URL"
echo "Logging in as $ALICE_HANDLE..."

# Create session (login)
SESSION_RESPONSE=$(curl -s -X POST "$PDS_URL/xrpc/com.atproto.server.createSession" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\": \"$ALICE_HANDLE\", \"password\": \"$ALICE_PASSWORD\"}")

# Extract access token and DID
ACCESS_JWT=$(json_field "$SESSION_RESPONSE" "accessJwt")
DID=$(json_field "$SESSION_RESPONSE" "did")

if [ -z "$ACCESS_JWT" ] || [ "$ACCESS_JWT" = "null" ] || [ -z "$DID" ] || [ "$DID" = "null" ]; then
  echo "Error: Failed to login"
  echo "Response: $SESSION_RESPONSE"
  exit 1
fi

echo "Logged in successfully!"
echo "DID: $DID"
echo "Creating post: $POST_TEXT"

# Create the post record
CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

POST_RESPONSE=$(curl -s -X POST "$PDS_URL/xrpc/com.atproto.repo.createRecord" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_JWT" \
  -d "{
    \"repo\": \"$DID\",
    \"collection\": \"app.bsky.feed.post\",
    \"record\": {
      \"\$type\": \"app.bsky.feed.post\",
      \"text\": \"$POST_TEXT\",
      \"langs\": [\"en\"],
      \"createdAt\": \"$CREATED_AT\"
    }
  }")

# Extract URI and CID from response
URI=$(json_field "$POST_RESPONSE" "uri")
CID=$(json_field "$POST_RESPONSE" "cid")

if [ -z "$URI" ] || [ "$URI" = "null" ] || [ -z "$CID" ] || [ "$CID" = "null" ]; then
  echo "Error: Failed to create post"
  echo "Response: $POST_RESPONSE"
  exit 1
fi

echo "Post created successfully!"
echo "URI: $URI"
echo "CID: $CID"

