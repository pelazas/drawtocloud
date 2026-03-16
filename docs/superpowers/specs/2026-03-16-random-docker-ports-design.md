# Random Host Ports for Multi-Worktree Docker

## Goal

Allow multiple worktrees of this repository to run with Docker at the same time without host port collisions.

## Current Problem

The current Compose setup publishes fixed host ports:

- Frontend: `3000:3000`
- Backend: `8000:8000`

Starting a second worktree fails because Docker cannot bind the same host port twice. The frontend configuration also assumes the backend is available at `http://localhost:8000` and `ws://localhost:8000/ws`, which only works when the backend host port is fixed.

## Chosen Approach

Use Docker-assigned random host ports for a single browser-facing reverse proxy while keeping stable internal service ports inside the Compose network.

## Design

### Compose Networking

- Add a lightweight reverse-proxy service as the only published entrypoint.
- Replace fixed host bindings with a published proxy port that lets Docker choose an available host port.
- Keep frontend and backend service ports unchanged inside the Compose network and stop publishing them directly to the host.
- Expect each worktree to run under its own Compose project name so container names and networks do not collide.

### Application Configuration

- Route browser traffic through the reverse proxy so the browser only needs the proxy host and port.
- Proxy `/` to the frontend service and proxy `/api` plus `/ws` to the backend service.
- Configure the frontend Docker environment to use same-origin backend paths such as `/api` and `/ws`.
- Keep non-Docker local development support through existing localhost-based frontend env examples.
- Use `docker compose port proxy 80` to discover the assigned host port.

### Developer Workflow

- `docker compose up --build` should work in more than one worktree at once.
- A developer can inspect the assigned browser URL after startup with `docker compose port proxy 80`.
- No per-worktree manual port allocation is required.

## Verification

1. Start one worktree with Docker Compose and confirm both services start.
2. Start a second worktree with a distinct Compose project name and confirm startup also succeeds.
3. Confirm `docker compose port proxy 80` returns different host ports per worktree.
4. Load the proxy URL from each worktree and verify frontend-to-backend HTTP and WebSocket communication still works.

## Scope

In scope:

- Docker Compose port publishing changes
- Reverse-proxy service and routing configuration
- Frontend environment wiring for same-origin API and WebSocket access in Docker
- Startup verification for concurrent worktrees

Out of scope:

- Production deployment changes
- Reverse proxy setup
- Manual per-worktree port assignment

## Review Note

The brainstorming workflow expects a dedicated spec-review subagent. This environment does not provide that subagent interface, so the fallback is an in-session review before asking for user approval.
