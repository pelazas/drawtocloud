## Summary

<!-- Brief description of changes -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation
- [ ] Other:

## Security Checklist

- [ ] **No client-side API key storage:** I have not added `localStorage.setItem` / `getItem` / `removeItem` calls for credentials, API keys, tokens, or provider settings. All LLM API keys remain server-side only.
- [ ] **No new env vars leaked to client:** I have verified that any new secrets or API keys are not exposed in `NEXT_PUBLIC_*` variables or sent to the browser.
- [ ] **Auth checks:** New endpoints or WebSocket messages require a valid `access_token`.

## Verification

- [ ] Tests pass (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Build passes (`pnpm build`)
