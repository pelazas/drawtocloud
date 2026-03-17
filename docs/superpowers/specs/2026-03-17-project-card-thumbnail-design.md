# Project Card Thumbnail Banner — Design Spec
**Date:** 2026-03-17

## Overview

Show the OG thumbnail image as a full-width banner at the top of each project card on the dashboard (`/`). Cards without a thumbnail show a placeholder with the folder icon centered. All cards maintain a uniform height so the grid stays visually consistent.

---

## Data Layer

### `ProjectSummary` type (`frontend/lib/projects.ts`)
Add `thumbnailUrl: string | null` to the `ProjectSummary` type.

Note: `PersistedProject` already has `thumbnailUrl: string | null` (mapped in `mapProjectRow`). Only `ProjectSummary` and `toProjectSummary` need updating.

### `toProjectSummary` (`frontend/lib/projects.ts`)
Add to the return object:
```ts
thumbnailUrl: project.thumbnailUrl,
```

---

## `next.config.mjs` — Remote Image Patterns

Supabase Storage URLs are external. Next.js `<Image>` requires the hostname to be whitelisted. Add a `remotePatterns` entry in `next.config.mjs`:

```js
images: {
  remotePatterns: [
    {
      protocol: "https",
      hostname: "**.supabase.co",   // covers all Supabase project subdomains
      pathname: "/storage/v1/object/public/**",
    },
  ],
},
```

If `next.config.mjs` already has an `images` block, merge the new pattern into the existing array.

---

## Component: ProjectCard

**File:** `frontend/components/ProjectsDashboard/ProjectCard.tsx`

### Current structure (simplified)
```jsx
<div>                              // card wrapper
  <button onClick={onDelete} />    // delete btn — absolute, z-10
  <button onClick={onOpen}>        // entire card body — w-full, p-4
    <div>FolderKanban icon</div>
    <h3>title</h3>
    <div>metadata</div>
  </button>
</div>
```

### New structure
```jsx
<div>                              // card wrapper — rounded-2xl
  <button onClick={onDelete} />    // delete btn — unchanged, absolute, z-10

  {/* Banner — sits between delete btn and open btn, full-width, clickable */}
  <button
    type="button"
    onClick={() => onOpen(project.id)}
    className="w-full"
  >
    {project.thumbnailUrl ? (
      <div className="relative h-[120px] w-full overflow-hidden rounded-t-2xl">
        <Image
          src={project.thumbnailUrl}
          alt={project.title}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
      </div>
    ) : (
      <div className="flex h-[120px] items-center justify-center rounded-t-2xl bg-gray-800/50">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-300">
          <FolderKanban size={18} />
        </div>
      </div>
    )}
  </button>

  <button onClick={() => onOpen(project.id)} className="w-full text-left p-4">
    {/* Remove the old folder icon div from here */}
    <h3>title</h3>
    <div>metadata</div>
  </button>
</div>
```

### Key decisions
- The banner is a separate `<button>` (not inside the existing one) so it can be full-width without fighting the `p-4` padding on the body button
- Both banner and body buttons call `onOpen(project.id)` — clicking anywhere opens the project
- The delete button (`absolute right-3 top-3 z-10`) sits above the banner visually due to `z-10`
- Remove the `<div className="mb-4"><FolderKanban /></div>` block from inside the body button — the icon now only lives in the no-thumbnail placeholder
- Card wrapper keeps `rounded-2xl`; banner gets `rounded-t-2xl`; body button has no border radius (card provides it)

---

## Testing

- TypeScript compile check: `pnpm tsc --noEmit` passes
- Visual: cards with thumbnail show image banner; cards without show centered folder icon placeholder
- Delete button renders correctly over the banner (z-10 overlay)
- Grid stays visually uniform (all cards same banner height)
- Clicking the banner opens the project (same as clicking the body)

---

## Out of Scope

- Loading skeleton / blur placeholder for the thumbnail image
- Thumbnail in other views (project detail page, etc.)
