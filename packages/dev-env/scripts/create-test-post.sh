#!/bin/bash

# Script to create a test post for the alice user in the dev environment.
#
# Usage:
#   ./packages/dev-env/scripts/create-test-post.sh
#   ./packages/dev-env/scripts/create-test-post.sh "My custom post text"
#   ./packages/dev-env/scripts/create-test-post.sh -i /path/to/image.jpg "Post with image"
#   ./packages/dev-env/scripts/create-test-post.sh --image /path/to/image.jpg --alt "Image description" "Post text"
#
# Requires the dev environment to be running (make run-dev-env-logged)

set -e

PDS_URL="https://fa04a8aa3e69.ngrok-free.app"
ALICE_HANDLE="bob.test"
ALICE_PASSWORD="hunter2"

IMAGE_PATH=""
IMAGE_ALT=""
POST_TEXT=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -i|--image)
      IMAGE_PATH="$2"
      shift 2
      ;;
    --alt)
      IMAGE_ALT="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS] [POST_TEXT]"
      echo ""
      echo "Options:"
      echo "  -i, --image PATH   Path to an image file to attach to the post"
      echo "  --alt TEXT         Alt text for the image (default: 'Image')"
      echo "  -h, --help         Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0 \"Hello world!\""
      echo "  $0 -i photo.jpg \"Check out this photo!\""
      echo "  $0 --image photo.jpg --alt \"A beautiful sunset\" \"Amazing view!\""
      exit 0
      ;;
    *)
      POST_TEXT="$1"
      shift
      ;;
  esac
done

POST_TEXT="${POST_TEXT:-Test post created at $(date -u +"%Y-%m-%dT%H:%M:%SZ")}"
IMAGE_ALT="${IMAGE_ALT:-Image}"

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

# Helper to get nested JSON (requires jq)
json_nested() {
  local json="$1"
  local path="$2"
  if command -v jq &> /dev/null; then
    echo "$json" | jq -r "$path"
  else
    echo "Error: jq is required for image uploads" >&2
    exit 1
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

# Upload image if provided
EMBED_JSON=""
if [ -n "$IMAGE_PATH" ]; then
  if [ ! -f "$IMAGE_PATH" ]; then
    echo "Error: Image file not found: $IMAGE_PATH"
    exit 1
  fi

  # Determine mime type
  MIME_TYPE=$(file --mime-type -b "$IMAGE_PATH" 2>/dev/null || echo "image/jpeg")

  echo "Uploading image: $IMAGE_PATH ($MIME_TYPE)..."

  UPLOAD_RESPONSE=$(curl -s -X POST "$PDS_URL/xrpc/com.atproto.repo.uploadBlob" \
    -H "Content-Type: $MIME_TYPE" \
    -H "Authorization: Bearer $ACCESS_JWT" \
    --data-binary "@$IMAGE_PATH")

  # Extract blob reference using jq (required for nested JSON)
  BLOB_JSON=$(json_nested "$UPLOAD_RESPONSE" ".blob")

  if [ -z "$BLOB_JSON" ] || [ "$BLOB_JSON" = "null" ]; then
    echo "Error: Failed to upload image"
    echo "Response: $UPLOAD_RESPONSE"
    exit 1
  fi

  echo "Image uploaded successfully!"

  # Escape alt text for JSON
  ESCAPED_ALT=$(echo "$IMAGE_ALT" | sed 's/\\/\\\\/g; s/"/\\"/g')

  # Create embed JSON with the blob reference
  EMBED_JSON=",\"embed\":{
    \"\$type\": \"app.bsky.embed.images\",
    \"images\": [{
      \"image\": $BLOB_JSON,
      \"alt\": \"$ESCAPED_ALT\"
    }]
  }"
fi

echo "Creating post: $POST_TEXT"

# Create the post record
CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Escape post text for JSON
ESCAPED_TEXT=$(echo "$POST_TEXT" | sed 's/\\/\\\\/g; s/"/\\"/g')

POST_RESPONSE=$(curl -s -X POST "$PDS_URL/xrpc/com.atproto.repo.createRecord" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_JWT" \
  -d "{
    \"repo\": \"$DID\",
    \"collection\": \"app.bsky.feed.post\",
    \"record\": {
      \"\$type\": \"app.bsky.feed.post\",
      \"text\": \"$ESCAPED_TEXT\",
      \"langs\": [\"en\"],
      \"createdAt\": \"$CREATED_AT\"
      $EMBED_JSON
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
