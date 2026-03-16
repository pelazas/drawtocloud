# Random Docker Ports Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let multiple worktrees run this app with Docker concurrently by exposing a single Docker-assigned proxy port instead of fixed frontend and backend host ports.

**Architecture:** Add a lightweight reverse-proxy service as the only published entrypoint, route browser traffic to frontend and backend over the Compose network, and keep frontend browser API calls same-origin inside Docker. Verify the change first with a failing shell test over `docker compose config`, then with a runtime smoke test using two Compose project names in parallel.

**Tech Stack:** Docker Compose, nginx, Next.js 14, FastAPI, bash

---

## File Map

- Create: `proxy/nginx.conf` — reverse-proxy rules for frontend, backend HTTP, and backend WebSocket traffic
- Create: `tests/docker/test_compose_proxy.sh` — shell test that validates the rendered Compose config matches the proxy architecture
- Modify: `docker-compose.yml` — stop publishing frontend/backend ports, add proxy service, set Docker-specific frontend env vars
- Modify: `frontend/lib/websocket.ts` — support relative `/ws` values by resolving them against the browser location
- Modify: `docs/superpowers/specs/2026-03-16-random-docker-ports-design.md` — keep the approved design doc aligned with the verified implementation

## Chunk 1: Lock In Expected Compose Behavior

### Task 1: Add a failing Compose architecture test

**Files:**
- Create: `tests/docker/test_compose_proxy.sh`

- [ ] **Step 1: Write the failing test**

```bash
#!/usr/bin/env bash
set -euo pipefail

rendered="$(docker compose config)"

echo "$rendered" | grep -q "proxy:" || {
  echo "expected proxy service in rendered compose config"
  exit 1
}

echo "$rendered" | grep -q '"3000:3000"' && {
  echo "frontend must not publish a fixed host port"
  exit 1
}

echo "$rendered" | grep -q '"8000:8000"' && {
  echo "backend must not publish a fixed host port"
  exit 1
}

echo "$rendered" | grep -q "NEXT_PUBLIC_API_URL: \"\"" || {
  echo "frontend must use same-origin API base in Docker"
  exit 1
}

echo "$rendered" | grep -q "NEXT_PUBLIC_WS_URL: /ws" || {
  echo "frontend must use same-origin WebSocket path in Docker"
  exit 1
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/docker/test_compose_proxy.sh`
Expected: FAIL because the current config has no `proxy` service and still publishes fixed `3000:3000` and `8000:8000` bindings.

- [ ] **Step 3: Commit**

```bash
git add tests/docker/test_compose_proxy.sh
git commit -m "test: add compose proxy expectation"
```

## Chunk 2: Implement the Proxy-Based Docker Topology

### Task 2: Add reverse proxy and compose changes

**Files:**
- Create: `proxy/nginx.conf`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Write the reverse-proxy config**

```nginx
server {
  listen 80;

  location /api/ {
    proxy_pass http://backend:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /ws {
    proxy_pass http://backend:8000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }

  location / {
    proxy_pass http://frontend:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

- [ ] **Step 2: Update Compose to use the proxy as the only published service**

```yaml
frontend:
  environment:
    - NEXT_PUBLIC_WS_URL=/ws
    - NEXT_PUBLIC_API_URL=

backend:
  ports: []

proxy:
  image: nginx:alpine
  depends_on:
    - frontend
    - backend
  ports:
    - target: 80
      published: 0
      protocol: tcp
      mode: ingress
```

- [ ] **Step 3: Run the Compose architecture test**

Run: `bash tests/docker/test_compose_proxy.sh`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml proxy/nginx.conf tests/docker/test_compose_proxy.sh
git commit -m "feat: proxy docker services through one port"
```

### Task 3: Support same-origin WebSocket URLs in the frontend

**Files:**
- Modify: `frontend/lib/websocket.ts`

- [ ] **Step 1: Write the failing implementation expectation**

Expectation: `NEXT_PUBLIC_WS_URL=/ws` must resolve to `ws://<current-host>/ws` or `wss://<current-host>/ws` in the browser, while full absolute URLs continue to work unchanged.

- [ ] **Step 2: Implement the minimal URL resolution helper**

```ts
function resolveWebSocketUrl(raw: string | undefined): string {
  if (!raw || raw.startsWith("ws://") || raw.startsWith("wss://")) {
    return raw ?? "ws://localhost:8000/ws";
  }

  if (typeof window === "undefined") {
    return raw;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${raw}`;
}
```

- [ ] **Step 3: Run lint or type-check level verification for the changed frontend file**

Run: `pnpm --dir frontend exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/websocket.ts
git commit -m "fix: support relative websocket urls"
```

## Chunk 3: Runtime Verification

### Task 4: Prove two Compose projects can run concurrently

**Files:**
- Modify: `docs/superpowers/specs/2026-03-16-random-docker-ports-design.md`

- [ ] **Step 1: Start the first Compose project**

Run: `docker compose -p drawtocloud_a up -d --build`
Expected: PASS

- [ ] **Step 2: Start the second Compose project**

Run: `docker compose -p drawtocloud_b up -d --build`
Expected: PASS

- [ ] **Step 3: Verify distinct published proxy ports**

Run: `docker compose -p drawtocloud_a port proxy 80`
Expected: prints a host port

Run: `docker compose -p drawtocloud_b port proxy 80`
Expected: prints a different host port

- [ ] **Step 4: Tear both projects down**

Run: `docker compose -p drawtocloud_a down -v`
Expected: PASS

Run: `docker compose -p drawtocloud_b down -v`
Expected: PASS

- [ ] **Step 5: Commit remaining plan-alignment changes**

```bash
git add docs/superpowers/specs/2026-03-16-random-docker-ports-design.md
git commit -m "docs: align docker port spec"
```
