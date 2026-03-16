#!/usr/bin/env bash
set -euo pipefail

rendered="$(docker compose config)"

echo "$rendered" | grep -Eq '^[[:space:]]+proxy:$' || {
  echo "expected proxy service in rendered compose config"
  exit 1
}

echo "$rendered" | grep -Eq '3000:3000' && {
  echo "frontend must not publish a fixed host port"
  exit 1
}

echo "$rendered" | grep -Eq '8000:8000' && {
  echo "backend must not publish a fixed host port"
  exit 1
}

echo "$rendered" | grep -Eq 'NEXT_PUBLIC_API_URL:[[:space:]]*""' || {
  echo "frontend must use same-origin API base in Docker"
  exit 1
}

echo "$rendered" | grep -Eq 'NEXT_PUBLIC_WS_URL:[[:space:]]*/ws' || {
  echo "frontend must use same-origin WebSocket path in Docker"
  exit 1
}

echo "$rendered" | grep -Eq 'OPENROUTER_API_KEY:' || {
  echo "backend must receive OPENROUTER_API_KEY from compose env"
  exit 1
}

echo "$rendered" | grep -Eq 'ANTHROPIC_API_KEY:' || {
  echo "backend must receive ANTHROPIC_API_KEY from compose env"
  exit 1
}

echo "$rendered" | grep -Eq 'OPENAI_API_KEY:' || {
  echo "backend must receive OPENAI_API_KEY from compose env"
  exit 1
}

echo "$rendered" | grep -Eq '/app/\.venv' || {
  echo "backend must isolate its virtualenv with a container volume"
  exit 1
}

echo "compose proxy config looks correct"
