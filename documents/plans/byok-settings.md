# BYOK (Bring Your Own Key) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users store their own LLM API key (Anthropic/OpenRouter/OpenAI) server-side so they get unlimited generations, and guide quota-exhausted users to set up BYOK.

**Architecture:** New Supabase table `user_llm_keys` stores encrypted keys (Fernet, app-level). Three new REST endpoints manage keys. Backend `llm_client.py` is refactored to accept runtime credentials. Quota check is bypassed when a BYOK key exists. Frontend adds a Settings button + modal on the dashboard, plus a quota-exhaustion prompt.

**Tech Stack:** FastAPI, cryptography (Fernet), Supabase, Next.js 14, Tailwind CSS, lucide-react

---

## File Structure

### Backend (new files)
- `backend/llm_keys.py` — Encryption helpers + CRUD for `user_llm_keys` table
- `backend/tests/test_llm_keys.py` — Unit tests for encryption + CRUD

### Backend (modified files)
- `backend/llm_client.py` — Refactor `async_stream_text` and `async_complete` to accept optional `provider`/`api_key`/`model` params
- `backend/main.py` — Add 3 new REST endpoints: `POST /api/llm-key`, `GET /api/llm-key`, `DELETE /api/llm-key`
- `backend/generation_service.py` — Look up BYOK key before generation; bypass quota if found; pass credentials to agents
- `backend/ws_handler.py` — Look up BYOK key for chat/canvas_edit flows; pass to LLM client
- `backend/agents/requirements.py` — Accept optional LLM credentials param
- `backend/agents/architect.py` — Accept optional LLM credentials param
- `backend/agents/coder.py` — Accept optional LLM credentials param
- `backend/agents/cost_analyst.py` — Accept optional LLM credentials param
- `backend/agents/description.py` — Accept optional LLM credentials param
- `backend/agents/discovery_agent.py` — Accept optional LLM credentials param
- `backend/agents/chat_agent.py` — Accept optional LLM credentials param
- `backend/requirements.txt` — Add `cryptography` dependency

### Frontend (new files)
- `frontend/components/ApiKeyModal/index.tsx` — Modal UI (provider select, key input, model input for OpenRouter)
- `frontend/components/ApiKeyModal/useApiKeyModal.ts` — Modal state, save/delete API calls
- `frontend/lib/llmKeys.ts` — Fetch helpers: `saveLlmKey()`, `getLlmKeyStatus()`, `deleteLlmKey()`

### Frontend (modified files)
- `frontend/components/ProjectsDashboard.tsx` — Add Settings (gear) button in header; quota-exhaustion prompt on "New Generation" click
- `frontend/app/page.tsx` — Pass BYOK status + onOpenSettings callback to ProjectsDashboard

### Database
- New Supabase table: `user_llm_keys` (`id uuid PK`, `user_id uuid FK UNIQUE`, `provider text`, `encrypted_key text`, `model text NULL`, `created_at timestamptz`, `updated_at timestamptz`)
- RLS: users can only read/write their own row

---

## Chunk 1: Backend — Encryption + Key Storage

### Task 1: Add `cryptography` dependency

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add cryptography to requirements.txt**

Add `cryptography>=42.0.0` to `backend/requirements.txt`.

- [ ] **Step 2: Install dependency**

Run: `cd backend && uv pip install -r requirements.txt`
Expected: cryptography installed successfully

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore: add cryptography dependency for BYOK key encryption"
```

### Task 2: Create `user_llm_keys` Supabase table

**Files:**
- Create: `backend/migrations/001_user_llm_keys.sql` (reference file, run manually in Supabase)

- [ ] **Step 1: Write migration SQL**

```sql
-- Run this in Supabase SQL editor
CREATE TABLE IF NOT EXISTS user_llm_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openrouter', 'openai')),
  encrypted_key text NOT NULL,
  model text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE user_llm_keys ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (backend uses service key)
CREATE POLICY "Service role full access" ON user_llm_keys
  FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Run the migration in Supabase SQL editor**

Go to Supabase dashboard → SQL Editor → paste and run.

- [ ] **Step 3: Commit migration file**

```bash
git add backend/migrations/001_user_llm_keys.sql
git commit -m "feat: add user_llm_keys table migration"
```

### Task 3: Build `llm_keys.py` — encryption + CRUD

**Files:**
- Create: `backend/llm_keys.py`
- Create: `backend/tests/test_llm_keys.py`

- [ ] **Step 1: Write the failing test for encryption round-trip**

Create `backend/tests/__init__.py` (empty) if it doesn't exist, then `backend/tests/test_llm_keys.py`:

```python
import os
import pytest

os.environ.setdefault("LLM_KEY_ENCRYPTION_SECRET", "test-secret-key-for-unit-tests-only!!")

from llm_keys import encrypt_api_key, decrypt_api_key


def test_encrypt_decrypt_roundtrip():
    original = "sk-ant-api03-test-key-1234567890"
    encrypted = encrypt_api_key(original)
    assert encrypted != original
    assert decrypt_api_key(encrypted) == original


def test_encrypted_values_differ():
    """Fernet produces different ciphertext each time (random IV)."""
    key = "sk-test-key"
    a = encrypt_api_key(key)
    b = encrypt_api_key(key)
    assert a != b


def test_decrypt_invalid_token():
    with pytest.raises(Exception):
        decrypt_api_key("not-valid-fernet-token")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run python -m pytest tests/test_llm_keys.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'llm_keys'`

- [ ] **Step 3: Write `llm_keys.py`**

```python
import asyncio
import base64
import hashlib
import os
from typing import Any

from cryptography.fernet import Fernet

from supabase_client import supabase

_TABLE = "user_llm_keys"


def _derive_fernet_key() -> bytes:
    """Derive a 32-byte Fernet key from LLM_KEY_ENCRYPTION_SECRET env var."""
    secret = os.environ.get("LLM_KEY_ENCRYPTION_SECRET", "")
    if not secret:
        raise RuntimeError("LLM_KEY_ENCRYPTION_SECRET env var is required for BYOK.")
    digest = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_api_key(plaintext: str) -> str:
    f = Fernet(_derive_fernet_key())
    return f.encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    f = Fernet(_derive_fernet_key())
    return f.decrypt(ciphertext.encode()).decode()


def _upsert_key_sync(user_id: str, provider: str, encrypted_key: str, model: str | None) -> dict[str, Any]:
    row = {
        "user_id": user_id,
        "provider": provider,
        "encrypted_key": encrypted_key,
        "model": model,
        "updated_at": "now()",
    }
    response = (
        supabase.table(_TABLE)
        .upsert(row, on_conflict="user_id")
        .execute()
    )
    data = getattr(response, "data", None)
    if not data:
        raise RuntimeError("Failed to save LLM key.")
    return data[0] if isinstance(data, list) and data else {}


async def save_user_llm_key(user_id: str, provider: str, api_key: str, model: str | None = None) -> dict[str, Any]:
    encrypted = encrypt_api_key(api_key)
    return await asyncio.to_thread(_upsert_key_sync, user_id, provider, encrypted, model)


def _get_key_sync(user_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table(_TABLE)
        .select("provider, encrypted_key, model")
        .eq("user_id", user_id)
        .maybeSingle()
        .execute()
    )
    data = getattr(response, "data", None)
    return data if isinstance(data, dict) else None


async def get_user_llm_key(user_id: str) -> dict[str, Any] | None:
    """Returns { provider, api_key (decrypted), model } or None."""
    row = await asyncio.to_thread(_get_key_sync, user_id)
    if not row:
        return None
    return {
        "provider": row["provider"],
        "api_key": decrypt_api_key(row["encrypted_key"]),
        "model": row.get("model"),
    }


async def get_user_llm_key_status(user_id: str) -> dict[str, Any] | None:
    """Returns { provider, has_key, model } without decrypting. Safe for client."""
    row = await asyncio.to_thread(_get_key_sync, user_id)
    if not row:
        return None
    return {
        "provider": row["provider"],
        "has_key": True,
        "model": row.get("model"),
    }


def _delete_key_sync(user_id: str) -> None:
    supabase.table(_TABLE).delete().eq("user_id", user_id).execute()


async def delete_user_llm_key(user_id: str) -> None:
    await asyncio.to_thread(_delete_key_sync, user_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m pytest tests/test_llm_keys.py -v`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/llm_keys.py backend/tests/
git commit -m "feat: add llm_keys module with Fernet encryption + CRUD"
```

---

## Chunk 2: Backend — REST Endpoints + LLM Client Refactor

### Task 4: Add REST endpoints to `main.py`

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add Pydantic models for request/response**

Add after the existing Pydantic models (around line 60):

```python
class SaveLlmKeyRequest(BaseModel):
    provider: str
    api_key: str
    model: str | None = None

class LlmKeyStatusResponse(BaseModel):
    has_key: bool
    provider: str | None = None
    model: str | None = None
```

- [ ] **Step 2: Add POST /api/llm-key endpoint**

```python
@app.post(
    "/api/llm-key",
    summary="Save user LLM API key",
    description="Encrypts and stores the user's LLM API key for BYOK usage. One key per user.",
    tags=["byok"],
)
async def save_llm_key_endpoint(
    req: SaveLlmKeyRequest,
    authorization: str | None = Header(default=None),
):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    if req.provider not in ("anthropic", "openrouter", "openai"):
        raise HTTPException(status_code=400, detail={"error": "invalid_provider", "message": "Provider must be anthropic, openrouter, or openai."})

    if not req.api_key.strip():
        raise HTTPException(status_code=400, detail={"error": "invalid_key", "message": "API key must not be empty."})

    if req.provider == "openrouter" and not req.model:
        raise HTTPException(status_code=400, detail={"error": "model_required", "message": "Model is required for OpenRouter."})

    from llm_keys import save_user_llm_key
    await save_user_llm_key(auth_user.user_id, req.provider, req.api_key.strip(), req.model)
    return {"status": "saved"}
```

- [ ] **Step 3: Add GET /api/llm-key endpoint**

```python
@app.get(
    "/api/llm-key",
    summary="Check if user has a stored LLM key",
    description="Returns provider and has_key status. Never returns the actual key.",
    response_model=LlmKeyStatusResponse,
    tags=["byok"],
)
async def get_llm_key_endpoint(authorization: str | None = Header(default=None)):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    from llm_keys import get_user_llm_key_status
    status = await get_user_llm_key_status(auth_user.user_id)
    if status is None:
        return {"has_key": False, "provider": None, "model": None}
    return status
```

- [ ] **Step 4: Add DELETE /api/llm-key endpoint**

```python
@app.delete(
    "/api/llm-key",
    summary="Delete user's stored LLM key",
    description="Removes the user's encrypted LLM key from the database.",
    tags=["byok"],
)
async def delete_llm_key_endpoint(authorization: str | None = Header(default=None)):
    token = _token_from_authorization_header(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated", "message": "Missing access token."})

    auth_user = await verify_access_token_user(token)
    if auth_user is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_token", "message": "Invalid access token."})

    from llm_keys import delete_user_llm_key
    await delete_user_llm_key(auth_user.user_id)
    return {"status": "deleted"}
```

- [ ] **Step 5: Commit**

```bash
git add backend/main.py
git commit -m "feat: add BYOK REST endpoints (save/get/delete LLM key)"
```

### Task 5: Refactor `llm_client.py` to accept runtime credentials

**Files:**
- Modify: `backend/llm_client.py`

The key change: `async_stream_text` and `async_complete` gain an optional `llm_creds` parameter of type `dict | None`. When provided, it overrides the module-level globals.

- [ ] **Step 1: Refactor `async_stream_text`**

Replace the entire `llm_client.py` with:

```python
import os
from typing import Any, AsyncGenerator


def _detect_provider() -> tuple[str, str, str] | None:
    if key := os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic", "claude-sonnet-4-20250514", key
    if key := os.environ.get("OPENAI_API_KEY"):
        return "openai", "gpt-4o", key
    if key := os.environ.get("OPENROUTER_API_KEY"):
        return "openrouter", "qwen/qwen3-235b-a22b-2507", key
    return None


_ENV_CREDS = _detect_provider()

PROVIDER_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openrouter": "qwen/qwen3-235b-a22b-2507",
    "openai": "gpt-4o",
}


def _resolve_creds(llm_creds: dict[str, Any] | None = None) -> tuple[str, str, str]:
    """Return (provider, model, api_key) from explicit creds or env fallback."""
    if llm_creds:
        provider = llm_creds["provider"]
        api_key = llm_creds["api_key"]
        model = llm_creds.get("model") or PROVIDER_MODELS.get(provider, "")
        return provider, model, api_key

    if _ENV_CREDS is None:
        raise RuntimeError(
            "No LLM API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY, "
            "or configure a BYOK key."
        )
    return _ENV_CREDS


async def async_stream_text(
    messages: list[dict],
    system: str,
    llm_creds: dict[str, Any] | None = None,
) -> AsyncGenerator[str, None]:
    provider, model, api_key = _resolve_creds(llm_creds)

    if provider == "anthropic":
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=api_key)
        async with client.messages.stream(
            model=model,
            max_tokens=2048,
            system=system,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text
    else:
        import openai as oai

        kwargs = dict(
            model=model,
            messages=[{"role": "system", "content": system}] + messages,
            stream=True,
        )
        if provider == "openrouter":
            client = oai.AsyncOpenAI(
                api_key=api_key,
                base_url="https://openrouter.ai/api/v1",
                default_headers={"HTTP-Referer": "https://drawtocloud.app"},
            )
        else:
            client = oai.AsyncOpenAI(api_key=api_key)
        stream = await client.chat.completions.create(**kwargs)
        async for chunk in stream:
            if not chunk.choices:
                continue
            yield chunk.choices[0].delta.content or ""


async def async_complete(
    messages: list[dict],
    system: str,
    llm_creds: dict[str, Any] | None = None,
) -> str:
    buffer = ""
    async for chunk in async_stream_text(messages, system, llm_creds):
        buffer += chunk
    return buffer
```

Note: `_detect_provider()` now returns `None` instead of raising, so the server can start without env keys (BYOK-only mode).

- [ ] **Step 2: Verify existing imports still work**

Run: `cd backend && uv run python -c "from llm_client import async_stream_text, async_complete; print('OK')"`

- [ ] **Step 3: Commit**

```bash
git add backend/llm_client.py
git commit -m "refactor: llm_client accepts runtime credentials for BYOK"
```

### Task 6: Thread BYOK credentials through agents

**Files:**
- Modify: `backend/agents/requirements.py`
- Modify: `backend/agents/architect.py`
- Modify: `backend/agents/coder.py`
- Modify: `backend/agents/cost_analyst.py`
- Modify: `backend/agents/description.py`
- Modify: `backend/agents/discovery_agent.py`
- Modify: `backend/agents/chat_agent.py`

Each agent calls `async_stream_text()` or `async_complete()`. The pattern is the same for all: add `llm_creds: dict | None = None` parameter to the agent's main function and pass it through to the llm_client calls.

- [ ] **Step 1: Read each agent file to identify all `async_stream_text` / `async_complete` call sites**

- [ ] **Step 2: Add `llm_creds` parameter to each agent's public function signature**

For each agent, add `llm_creds: dict[str, Any] | None = None` as the last parameter of the main function (e.g., `generate_requirements`, `stream_architecture`, `stream_terraform_files`, `run_cost_analyst`, `run_description_agent`, `stream_discovery_reply`, `stream_chat_reply`).

Then pass `llm_creds=llm_creds` to every `async_stream_text()` / `async_complete()` call inside.

- [ ] **Step 3: Verify no import errors**

Run: `cd backend && uv run python -c "from agents.requirements import generate_requirements; from agents.architect import stream_architecture; from agents.coder import stream_terraform_files; from agents.cost_analyst import run_cost_analyst; from agents.description import run_description_agent; from agents.discovery_agent import stream_discovery_reply; from agents.chat_agent import stream_chat_reply; print('OK')"`

- [ ] **Step 4: Commit**

```bash
git add backend/agents/
git commit -m "feat: thread llm_creds through all agents for BYOK support"
```

### Task 7: Wire BYOK into generation_service + ws_handler

**Files:**
- Modify: `backend/generation_service.py`
- Modify: `backend/ws_handler.py`

- [ ] **Step 1: Modify `generation_service.py`**

In `start_generation_for_user()`:
1. After auth, look up BYOK key: `from llm_keys import get_user_llm_key`
2. If BYOK key exists, skip quota check entirely
3. Store `llm_creds` in `GenerationRuntime` (add field)
4. Pass `llm_creds` to all agent calls in `_run_generation()`

Changes needed:
- Add `llm_creds: dict[str, Any] | None = None` field to `GenerationRuntime.__init__`
- In `start_generation_for_user`: look up key, skip quota if found, pass to runtime
- In `_run_generation`: pass `runtime.llm_creds` to `generate_requirements()`, `stream_architecture()`, and the parallel agents
- Also skip `increment_generations_used` when BYOK is active

- [ ] **Step 2: Modify `ws_handler.py`**

For `chat` and `canvas_edit` message types, look up BYOK key for the user and pass `llm_creds` to `stream_chat_reply()` / `stream_discovery_reply()`.

In the `chat` handler section:
```python
from llm_keys import get_user_llm_key
llm_creds = await get_user_llm_key(user_id) if user_id else None
```

Then pass `llm_creds=llm_creds` to `stream_chat_reply()` and `stream_discovery_reply()`.

- [ ] **Step 3: Verify server starts**

Run: `cd backend && uv run uvicorn main:app --host 0.0.0.0 --port 8000 &` then `curl http://localhost:8000/health`
Expected: `{"status": "ok"}`

- [ ] **Step 4: Commit**

```bash
git add backend/generation_service.py backend/ws_handler.py
git commit -m "feat: wire BYOK credentials into generation pipeline + chat"
```

---

## Chunk 3: Frontend — API Helpers + Settings Modal

### Task 8: Create frontend API helpers for LLM keys

**Files:**
- Create: `frontend/lib/llmKeys.ts`

- [ ] **Step 1: Write `llmKeys.ts`**

```typescript
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function getAuthHeader(): Promise<Record<string, string>> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type LlmKeyStatus = {
  has_key: boolean;
  provider: string | null;
  model: string | null;
};

export async function getLlmKeyStatus(): Promise<LlmKeyStatus> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_URL}/api/llm-key`, { headers });
  if (!res.ok) throw new Error("Failed to fetch LLM key status");
  return res.json();
}

export async function saveLlmKey(
  provider: string,
  apiKey: string,
  model?: string | null
): Promise<void> {
  const headers = { ...(await getAuthHeader()), "Content-Type": "application/json" };
  const res = await fetch(`${API_URL}/api/llm-key`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider, api_key: apiKey, model: model || undefined }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail?.message ?? "Failed to save LLM key");
  }
}

export async function deleteLlmKey(): Promise<void> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_URL}/api/llm-key`, { method: "DELETE", headers });
  if (!res.ok) throw new Error("Failed to delete LLM key");
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/llmKeys.ts
git commit -m "feat: add frontend API helpers for BYOK LLM key management"
```

### Task 9: Create ApiKeyModal component

**Files:**
- Create: `frontend/components/ApiKeyModal/useApiKeyModal.ts`
- Create: `frontend/components/ApiKeyModal/index.tsx`

- [ ] **Step 1: Write `useApiKeyModal.ts`**

```typescript
import { useCallback, useState } from "react";
import { getLlmKeyStatus, saveLlmKey, deleteLlmKey, LlmKeyStatus } from "@/lib/llmKeys";

export type ApiKeyModalState = {
  isOpen: boolean;
  provider: string;
  apiKey: string;
  model: string;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  existing: LlmKeyStatus | null;
  loading: boolean;
};

export function useApiKeyModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<LlmKeyStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const open = useCallback(async () => {
    setIsOpen(true);
    setError(null);
    setApiKey("");
    setModel("");
    setLoading(true);
    try {
      const status = await getLlmKeyStatus();
      setExisting(status);
      if (status.has_key && status.provider) {
        setProvider(status.provider);
        if (status.model) setModel(status.model);
      }
    } catch {
      setExisting(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (!apiKey.trim()) {
      setError("API key is required.");
      return;
    }
    if (provider === "openrouter" && !model.trim()) {
      setError("Model is required for OpenRouter (e.g. qwen/qwen3.5-9b).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveLlmKey(provider, apiKey.trim(), provider === "openrouter" ? model.trim() : null);
      const status = await getLlmKeyStatus();
      setExisting(status);
      setApiKey("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [provider, apiKey, model]);

  const remove = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteLlmKey();
      setExisting(null);
      setProvider("anthropic");
      setModel("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }, []);

  return {
    isOpen, provider, apiKey, model, saving, deleting, error, existing, loading,
    setProvider, setApiKey, setModel,
    open, close, save, remove,
  };
}
```

- [ ] **Step 2: Write `ApiKeyModal/index.tsx`**

```tsx
"use client";

import { X, Key, Trash2 } from "lucide-react";
import { useApiKeyModal } from "./useApiKeyModal";

type Props = ReturnType<typeof useApiKeyModal>;

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai", label: "OpenAI" },
] as const;

export default function ApiKeyModal({
  isOpen, provider, apiKey, model, saving, deleting, error, existing, loading,
  setProvider, setApiKey, setModel,
  close, save, remove,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-white">AI Provider Settings</h2>
          </div>
          <button type="button" onClick={close} className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
        ) : (
          <>
            {existing?.has_key && (
              <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3">
                <p className="text-sm text-green-200">
                  Key configured: <span className="font-medium">{existing.provider}</span>
                  {existing.model && <span className="text-green-300"> ({existing.model})</span>}
                </p>
                <button
                  type="button"
                  onClick={remove}
                  disabled={deleting}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-red-300 hover:text-red-200 transition-colors"
                >
                  <Trash2 size={12} />
                  {deleting ? "Removing..." : "Remove key"}
                </button>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Provider</label>
                <div className="flex gap-2">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setProvider(p.value)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        provider === p.value
                          ? "border-blue-500 bg-blue-500/10 text-blue-200"
                          : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1.5">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={existing?.has_key ? "Enter new key to replace" : "sk-..."}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition-colors"
                />
              </div>

              {provider === "openrouter" && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Model</label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g. qwen/qwen3.5-9b"
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>
              )}

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-gray-500 max-w-[60%]">
                  Your key is encrypted and stored securely. It is never logged or shared.
                </p>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !apiKey.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? "Saving..." : "Save Key"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ApiKeyModal/
git commit -m "feat: add ApiKeyModal component for BYOK settings"
```

### Task 10: Integrate settings button + quota-exhaustion prompt into dashboard

**Files:**
- Modify: `frontend/components/ProjectsDashboard.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Add props to ProjectsDashboard**

Add to Props type:
```typescript
hasApiKey?: boolean;
onOpenSettings: () => void;
```

- [ ] **Step 2: Add Settings button in dashboard header**

In the header's `<div className="flex items-center gap-3">`, add a gear icon button before the quota label:

```tsx
<button
  type="button"
  onClick={onOpenSettings}
  className="rounded-lg border border-gray-700 bg-gray-800 p-2 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
  title="AI Provider Settings"
>
  <Settings size={16} />
</button>
```

Import `Settings` from `lucide-react`.

- [ ] **Step 3: Add quota-exhaustion prompt**

Modify `onNewGeneration` behavior: if `remainingGenerations === 0` and `!isAdmin` and `!hasApiKey`, instead of navigating to `/new`, show a prompt. Add state and a conditional banner/modal:

```tsx
{showQuotaPrompt && (
  <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-4">
    <p className="text-sm text-amber-200 mb-2">
      You've used all your free generations. Add your own API key for unlimited generations.
    </p>
    <button
      type="button"
      onClick={() => { setShowQuotaPrompt(false); onOpenSettings(); }}
      className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 transition-colors"
    >
      <Key size={14} />
      Add API Key
    </button>
  </div>
)}
```

- [ ] **Step 4: Wire up in `page.tsx`**

In `page.tsx`:
1. Import `useApiKeyModal` and `ApiKeyModal`
2. Call `const apiKeyModal = useApiKeyModal()`
3. Load key status on mount (alongside other initial data)
4. Pass `hasApiKey={apiKeyModal.existing?.has_key ?? false}` and `onOpenSettings={apiKeyModal.open}` to `ProjectsDashboard`
5. Render `<ApiKeyModal {...apiKeyModal} />` below `ProjectsDashboard`

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ProjectsDashboard.tsx frontend/app/page.tsx
git commit -m "feat: add BYOK settings button + quota-exhaustion prompt on dashboard"
```

---

## Chunk 4: Documentation Updates

### Task 11: Update documentation

**Files:**
- Modify: `documents/data-reference.md` — Add `user_llm_keys` entity
- Modify: `documents/platform-docs.md` — Document BYOK feature + endpoints
- Modify: `backend/CLAUDE.md` — Update API key handling section
- Modify: `frontend/CLAUDE.md` — Note BYOK modal and settings flow

- [ ] **Step 1: Update data-reference.md**

Add `user_llm_keys` table schema, relationship to `auth.users`, and note that `encrypted_key` is Fernet-encrypted with `LLM_KEY_ENCRYPTION_SECRET`.

- [ ] **Step 2: Update platform-docs.md**

Add BYOK section: endpoints, flow, quota bypass behavior.

- [ ] **Step 3: Update backend/CLAUDE.md**

Under "API Key Handling", add:
- BYOK flow: users can store their own key via `POST /api/llm-key`
- Keys are encrypted with Fernet (`LLM_KEY_ENCRYPTION_SECRET` env var)
- BYOK users bypass quota entirely
- New env var: `LLM_KEY_ENCRYPTION_SECRET` (required for BYOK)

- [ ] **Step 4: Update frontend/CLAUDE.md**

Add note about `ApiKeyModal` component and `llmKeys.ts` helpers.

- [ ] **Step 5: Commit**

```bash
git add documents/ backend/CLAUDE.md frontend/CLAUDE.md
git commit -m "docs: document BYOK feature, endpoints, and data shapes"
```
