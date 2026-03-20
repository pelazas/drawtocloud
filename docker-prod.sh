#!/usr/bin/env bash
set -e

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build "$@"

echo ""
echo "  Frontend: http://localhost:3100"
echo "  Backend:  http://localhost:8200"
echo "  Health:   http://localhost:8200/health"
echo ""
