# Fix: Logout from project page does not redirect to root (#235)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect logged-out users away from project/app routes to `/` after sign-out.

**Architecture:** Add a pure redirect guard in `frontend/lib/workspaceRedirect.ts`, cover it with a failing unit test first, then call it from `frontend/components/auth/AuthProvider.tsx` so logout transitions trigger `router.replace("/")` on app-domain routes.

**Tech Stack:** Next.js 14, React, TypeScript, Vitest

---

### Task 1: Reproduce with a failing test

**Files:**
- Create: `frontend/lib/__tests__/logoutRedirect.test.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`

- [ ] Write a failing unit test for `shouldRedirectLoggedOutUserToRoot`
- [ ] Run `pnpm test lib/__tests__/logoutRedirect.test.ts` and confirm failure because the helper does not exist yet
- [ ] Commit the failing test and any required test-runner dependency fix

### Task 2: Implement the redirect guard

**Files:**
- Modify: `frontend/lib/workspaceRedirect.ts`

- [ ] Add `shouldRedirectLoggedOutUserToRoot({ authLoading, hasUser, pathname })`
- [ ] Re-run `pnpm test lib/__tests__/logoutRedirect.test.ts` and confirm it passes
- [ ] Commit the helper implementation

### Task 3: Wire the guard into auth flow

**Files:**
- Modify: `frontend/components/auth/AuthProvider.tsx`

- [ ] Add a `useEffect` that redirects logged-out users on app-domain, non-auth routes to `/`
- [ ] Run targeted and broader frontend verification
- [ ] Commit the redirect wiring

### Task 4: Finish branch

- [ ] Push branch
- [ ] Create PR that closes `#235`
