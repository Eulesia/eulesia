# Architecture Patterns

Project structure, API client design, state management, type design,
and testing strategy for the Eulesia React frontend.

## Project structure

```
src/
├── App.tsx                     Routes, auth wrapper, layout
├── main.tsx                    Entry point, providers
├── pages/                      Page components (one per route)
│   ├── LoginPage.tsx
│   ├── AgoraPage.tsx
│   ├── ClubsPage.tsx
│   └── ProfilePage.tsx
├── components/                 Shared and domain components
│   ├── agora/                  Agora domain components
│   ├── clubs/                  Club domain components
│   ├── admin/                  Admin panel components
│   ├── SEOHead.tsx             Utility components
│   └── ui/                     Generic UI (Button, Modal, Spinner)
├── hooks/                      Custom React hooks
│   ├── useAuth.ts              Auth state, login/logout
│   └── useApi.ts               API call hooks
├── lib/                        Non-React utilities
│   ├── api.ts                  Typed API client
│   └── runtimeConfig.ts        Environment config
├── types/                      Shared TypeScript types
├── utils/                      Pure utility functions
└── test/                       Test utilities
```

**Rules**:

- `pages/` has one file per route — thin, delegates to components
- `components/` split by domain (`agora/`, `clubs/`) and generic (`ui/`)
- `hooks/` for reusable stateful logic
- `lib/` for non-React code (API client, config, crypto)
- Components never import from `lib/api.ts` directly — use hooks or page props
- All user-facing strings via `useTranslation()`

## Type design

### API response types

Type API responses at the boundary. Use the API client, not raw fetch.

```typescript
// types/thread.ts
export interface Thread {
  id: string;
  title: string;
  content: string;
  authorId: string;
  scope: Scope;
  score: number;
  replyCount: number;
  createdAt: string;
}

export type Scope = "local" | "national" | "european";
```

### Branded types for IDs

Prevent mixing up IDs of different entities:

```typescript
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ThreadId = Brand<string, "ThreadId">;
export type UserId = Brand<string, "UserId">;
export type ClubId = Brand<string, "ClubId">;
```

### Utility types

```typescript
// Paginated response from server
type Paginated<T> = {
  data: T[];
  total: number;
  offset: number;
  limit: number;
};

// Async state for UI
type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: AppError };

// API error
type AppError = {
  code: string;
  message: string;
  detail?: string;
  recovery?: "retry" | "refresh" | "login";
};
```

## State management

### State location hierarchy (most preferred first)

1. **Derived** (`useMemo`): Computed from other state. Always correct.
2. **Local** (`useState`): UI state in one component.
3. **URL** (`useSearchParams`): Bookmarkable view state.
4. **Context** (`React.createContext`): Cross-component state (auth, theme).
5. **React Query** (`@tanstack/react-query`): Server state cache.

### What goes where

| State              | Location             | Example                                   |
| ------------------ | -------------------- | ----------------------------------------- |
| View filters       | URL params           | `?scope=local&sort=newest`                |
| Active tab         | URL params           | `?tab=threads`                            |
| Pagination         | URL params           | `?page=3`                                 |
| Modal open/closed  | Component `useState` | `const [show, setShow] = useState(false)` |
| Form field values  | Component `useState` | `const [title, setTitle] = useState('')`  |
| Authenticated user | Context              | `useAuth()`                               |
| Thread list cache  | React Query          | `useQuery(['threads', scope])`            |

## Auth and role architecture

Three distinct role systems — never conflate them:

| System         | Roles                                 | Scope          | Auth hook                      |
| -------------- | ------------------------------------- | -------------- | ------------------------------ |
| Platform user  | `citizen`, `institution`, `moderator` | Site-wide      | `useAuth()`                    |
| Platform admin | Binary (authenticated or not)         | Operator panel | `useAdminAuth()`               |
| Club member    | `member`, `moderator`, `admin`        | Per-club       | Returned on club API responses |

Key rules:

- **Admin is NOT a user role.** Admin accounts live in a separate table with separate sessions. Never check `user.role === "admin"` for platform admin access.
- **Moderator IS a user role.** Use `user.role === "moderator"` for content moderation permissions (edit/delete any thread or comment).
- **Club roles are scoped.** `club.memberRole === "admin"` is a club-level role, unrelated to platform roles.
- Admin routes are protected by `AdminRoute` component + `useAdminAuth()`, not by user role checks.

## API client design

### Typed API client

All API calls go through `src/lib/api.ts`:

```typescript
// lib/api.ts — central, typed, handles auth
export const api = {
  async getThreads(
    scope: Scope,
    params?: PaginationParams,
  ): Promise<Paginated<Thread>> {
    const res = await fetch(buildApiUrl(`/api/v1/threads?scope=${scope}&...`), {
      credentials: "include",
    });
    if (!res.ok) throw await parseApiError(res);
    return res.json();
  },

  async createThread(data: CreateThread): Promise<Thread> {
    const res = await fetch(buildApiUrl("/api/v1/threads"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });
    if (!res.ok) throw await parseApiError(res);
    return res.json();
  },
};
```

### Error parsing

```typescript
async function parseApiError(res: Response): Promise<AppError> {
  try {
    const body = await res.json();
    return {
      code: body.code ?? `http_${res.status}`,
      message: body.message ?? res.statusText,
      detail: body.detail,
      recovery:
        res.status === 401 ? "login" : res.status >= 500 ? "retry" : undefined,
    };
  } catch {
    return {
      code: `http_${res.status}`,
      message: res.statusText || "Request failed",
    };
  }
}
```

## Testing strategy

| Layer       | Test type | Tools                          | What to verify                    |
| ----------- | --------- | ------------------------------ | --------------------------------- |
| Types/utils | Unit      | Vitest                         | Input → output, edge cases        |
| Hooks       | Unit      | Vitest + renderHook            | State transitions, API calls      |
| Components  | Component | Vitest + testing-library/react | Renders correctly, handles events |
| Pages       | E2E       | Playwright                     | User flows, auth, navigation      |

### Component testing principle

Test behavior, not implementation:

```typescript
// GOOD: tests what the user sees
test('shows error when title is empty', async () => {
  render(<CreateThreadForm onSubmit={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /submit/i }));
  expect(screen.getByText(/title is required/i)).toBeVisible();
});

// BAD: tests implementation details
test('sets error state', () => {
  const { result } = renderHook(() => useForm(...));
  expect(result.current.errors.title).toBeDefined();
});
```

## Internationalization

All user-facing strings go through react-i18next:

```typescript
import { useTranslation } from 'react-i18next';

function ThreadCard({ thread }: { thread: Thread }) {
  const { t } = useTranslation();
  return (
    <article>
      <h3>{thread.title}</h3>
      <span>{t('thread.replies', { count: thread.replyCount })}</span>
    </article>
  );
}
```

Translation files in `public/locales/{en,fi,sv}/`.
