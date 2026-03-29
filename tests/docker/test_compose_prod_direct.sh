#!/usr/bin/env bash
set -euo pipefail

rendered="$(docker compose -f docker-compose.yml -f docker-compose.prod.yml config)"

echo "$rendered" | grep -Eq '^[[:space:]]+proxy(_prod)?:$' && {
  echo "production compose must not include a proxy service"
  exit 1
}

echo "$rendered" | grep -Eq 'published:[[:space:]]*"3100"' || {
  echo "frontend must publish host port 3100 in production compose"
  exit 1
}

echo "$rendered" | grep -Eq 'target:[[:space:]]*3000' || {
  echo "frontend must target container port 3000 in production compose"
  exit 1
}

echo "$rendered" | grep -Eq 'published:[[:space:]]*"8200"' || {
  echo "backend must publish host port 8200 in production compose"
  exit 1
}

echo "$rendered" | grep -Eq 'target:[[:space:]]*8000' || {
  echo "backend must target container port 8000 in production compose"
  exit 1
}

echo "$rendered" | grep -Eq 'NEXT_PUBLIC_API_URL:[[:space:]]*http://localhost:8200' || {
  echo "frontend must default NEXT_PUBLIC_API_URL to http://localhost:8200"
  exit 1
}

echo "$rendered" | grep -Eq 'NEXT_PUBLIC_WS_URL:[[:space:]]*ws://localhost:8200/ws' || {
  echo "frontend must default NEXT_PUBLIC_WS_URL to ws://localhost:8200/ws"
  exit 1
}

echo "production compose direct config looks correct"
