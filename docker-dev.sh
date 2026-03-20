#!/usr/bin/env bash
set -e

docker compose --profile dev up -d --build "$@"

PORT=$(docker compose port proxy 80 | cut -d: -f2)

echo ""
echo "  App running at http://localhost:$PORT"
echo ""
