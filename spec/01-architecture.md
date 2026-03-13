# Megatest Architecture Specification

## 1. System Overview

Megatest is a visual regression testing SaaS. It connects to a user's GitHub repository, spins up their web application inside an isolated Docker container, then uses a headless browser to navigate the app, capture screenshots, and compare them against approved baselines. When pixels differ beyond a configured threshold, the run fails and a diff image is produced.

The core workflow:

1. A GitHub webhook (push or PR) triggers a test run.
2. The API server enqueues a job.
3. A worker picks up the job, clones the repo, builds and starts the app in a Docker container.
4. Playwright (running on the worker host) connects to the containerized app and executes the test steps defined in `.megatest/`.
5. Screenshots are captured, diffed against baselines with `pixelmatch`, and results are stored.
6. Status is reported back to the GitHub commit/PR.

A secondary flow -- the Discovery Agent -- uses a configurable LLM (Claude, OpenAI, etc.) and Playwright to explore a running app, discover its workflows, and generate the `.megatest/` config files automatically. Users do not hand-write config.

---

## 2. Component Diagram

```
Self-hosted deployment:

                        ┌──────────┐
                        │  GitHub  │
                        └────┬─────┘
                             │ webhook / OAuth / status
                             ▼
                    ┌─────────────────┐        ┌───────────┐
                    │   API Server    │◄──────► │  Web UI   │
                    │   (Fastify)     │  embed  │  (SPA)    │
                    └────────┬────────┘        └───────────┘
                             │ enqueue job
                             ▼
                    ┌─────────────────┐
                    │   Job Queue     │
                    │  (BullMQ/Redis) │
                    └────────┬────────┘
                             │ dequeue
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Worker Host                              │
│                                                                 │
│  ┌──────────────┐    ┌───────────────────┐    ┌──────────────┐  │
│  │  Playwright   │───►│  Docker Container  │    │  pixelmatch  │  │
│  │  (Chromium)   │    │  (user app on      │    │  (diffing)   │  │
│  │              │◄───│   localhost:PORT)   │    │              │  │
│  └──────────────┘    └───────────────────┘    └──────────────┘  │
│         │                                            │          │
│         │ screenshots                                │ diffs    │
│         ▼                                            ▼          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Storage                                 │ │
│  │             (Local FS / S3-compatible)                      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   PostgreSQL    │
                    └─────────────────┘


SaaS deployment:

                        ┌──────────┐
                        │  GitHub  │
                        └────┬─────┘
                             │ webhook / OAuth / status
                             ▼
                    ┌─────────────────┐
                    │  Load Balancer  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
     │  API Server │ │  API Server │ │  API Server │
     │  (Fastify)  │ │  (Fastify)  │ │  (Fastify)  │
     └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
            │               │               │
            └───────────────┼───────────────┘
                            ▼
                   ┌─────────────────┐
                   │   Job Queue     │
                   │  (BullMQ/Redis) │
                   └────────┬────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │  Worker Host │ │  Worker Host │ │  Worker Host │
     └──────────────┘ └──────────────┘ └──────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │   PostgreSQL    │
                   └─────────────────┘


Discovery Agent Flow:
─────────────────────
  User triggers discovery
         │
         ▼
  ┌──────────────┐     ┌───────────────────┐
  │ Discovery    │────►│  Docker Container  │
  │ Agent        │     │  (user app)        │
  │ (LLM +      │◄────│                    │
  │  Playwright) │     └───────────────────┘
  └──────┬───────┘
         │ generates
         ▼
  ┌──────────────┐
  │ .megatest/   │  ──► committed to config repo via PR
  │ config files │
  └──────────────┘
```

---

## 3. Component Table

| Component | Technology | Purpose |
|---|---|---|
| API Server | Node.js + Fastify | HTTP API, webhook receiver, GitHub OAuth, serves Web UI |
| Web UI | Embedded SPA (vanilla JS or Preact) | Dashboard for runs, diffs, baseline approval |
| Job Queue | BullMQ + Redis | Reliable job scheduling and delivery to workers |
| Worker | Node.js process on host | Orchestrates container lifecycle, runs Playwright, runs pixelmatch |
| Browser Automation | Playwright (npm) | Headless Chromium control via CSS selectors, role/text/testid/label locators, page.locator(), page.getByRole(), etc. |
| Image Diffing | `pixelmatch` (npm) | Pixel-level screenshot comparison, produces diff images |
| User App Isolation | Docker (one container per run) | Sandboxed execution of user code |
| Database | PostgreSQL | Stores runs, projects, baselines, users, orgs, usage records |
| Storage | Local filesystem or S3-compatible | Stores screenshot PNGs, baseline images, diff images |
| Auth | GitHub OAuth | Multi-tenant login, repo-scoped access |
| Config | `.megatest/` directory in config repo | Test definitions, viewport settings, thresholds — AI-generated. Config repo can be the project repo itself. |
| Discovery Agent | Configurable LLM + Playwright | Explores running app, discovers workflows, generates `.megatest/` config |

---

## 4. Key Design Decisions

### 4.1 Playwright for browser automation

Playwright is the industry-standard browser automation library, maintained by Microsoft. It is chosen because:

- Flexible locator strategies: CSS selectors, XPath, role-based (`page.getByRole()`), text-based (`page.getByText()`), testid-based (`page.getByTestId()`), and label-based (`page.getByLabel()`).
- Maintained by Microsoft with a huge ecosystem, excellent documentation, and active community.
- Supports all major browsers (Chromium, Firefox, WebKit), though Megatest uses headless Chromium.
- First-class Node.js API — installed as an npm dependency in the worker.
- Built-in screenshot, network interception, and waiting primitives.
- Installed in the worker runtime environment via `npx playwright install chromium`.

### 4.2 Docker per run for worker isolation

User application code is untrusted. Each run gets a fresh Docker container that:

- Is destroyed after the run completes (no state leakage between runs).
- Is not reachable from the public network.
- Runs with resource limits (CPU, memory, timeout).

Playwright and Chromium run alongside the worker process, not inside the
user app container. In a bare-metal deployment they run on the host; in Docker
Compose they run inside the `worker` service container. The user app container
joins a per-run Docker network that is only reachable from the worker runtime.

### 4.3 pixelmatch for image diffing

`pixelmatch` is a small, fast, dependency-free library for pixel-level image comparison. It is used as a dedicated diffing layer because:

- Diffing is a distinct concern from browser automation.
- `pixelmatch` produces configurable threshold-based diffs with anti-aliasing detection.
- Diff images can be generated and stored independently of the browser session.

### 4.4 GitHub-only auth and git provider (MVP)

GitHub OAuth provides both authentication and authorization in one flow. Access is scoped: a user can only see projects for repos they have access to on GitHub. GitLab support is deferred to reduce surface area.

### 4.5 BullMQ + Redis for job queue

BullMQ provides:

- Reliable delivery with retries and backoff.
- Job priority, rate limiting, concurrency control.
- Dashboard-compatible (Bull Board) for operational visibility.
- Redis is already required, adding no new infrastructure.

### 4.6 PostgreSQL for database

PostgreSQL is the sole database backend. This simplifies the data layer by eliminating dialect abstraction and enables use of PostgreSQL-native features (UUID, TIMESTAMPTZ, JSONB, advisory locks). Self-hosted deployments include a PostgreSQL container in the Docker Compose stack.

### 4.7 `.megatest/` directory in a config repo

Config lives in a Git repository — either a dedicated config repo or the project repo itself. The `.megatest/` directory is split across multiple files so that:

- An AI agent (Discovery Agent or external LLM) can read/write individual files without loading the entire config.
- Individual test workflows can be added, removed, or modified independently.
- Merge conflicts are minimized.

The config repo approach means:

- Megatest doesn't need write access to the project repo.
- Config changes are version-controlled and reviewable.
- Teams can share a single config repo for multiple projects.

Users do not write these files. The Discovery Agent generates them.

### 4.8 Embedded SPA for Web UI

The Web UI is served directly by the Fastify API server (no separate frontend deployment). Vanilla JS or Preact keeps the bundle small and avoids a build toolchain dependency for the UI.

### 4.9 Tenant Isolation in Shared Worker Pool

All tenants share a pool of worker machines. Isolation is enforced at multiple layers:

- **Job distribution:** Jobs are distributed via BullMQ with per-org group concurrency. Each project is limited to 1 concurrent run; each org is limited to a maximum of N concurrent runs based on its billing tier.
- **Execution isolation:** Every run executes inside its own Docker container, which is destroyed on completion. Containers share no state with other runs.
- **Storage partitioning:** Screenshot, baseline, and diff storage paths are partitioned by org and project (e.g., `/{org_id}/{project_id}/...`), preventing cross-tenant access at the filesystem/object-store level.
- **Resource limits by tier:** Free-tier containers run with reduced resource limits (1 GB RAM, 1 CPU). Paid-tier containers receive higher limits (2 GB RAM, 2 CPU).

---

## 5. Deployment Model

Self-hosted deployment uses Docker Compose with three long-lived services. The
`worker` service image includes Playwright and Chromium (installed via
`npx playwright install chromium`) so the runtime is self-contained.

### 5.1 docker-compose.yml

```yaml
version: "3.8"

services:
  api:
    build: .
    command: node server/index.mjs
    ports:
      - "${API_PORT:-3000}:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL:-postgresql://megatest:megatest@postgres:5432/megatest}
      - REDIS_URL=redis://redis:6379
      - GITHUB_APP_ID=${GITHUB_APP_ID}
      - GITHUB_PRIVATE_KEY=${GITHUB_PRIVATE_KEY}
      - GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
      - GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
      - STORAGE_BACKEND=${STORAGE_BACKEND:-local}
      - STORAGE_PATH=/data/storage
      - S3_BUCKET=${S3_BUCKET:-}
      - S3_ENDPOINT=${S3_ENDPOINT:-}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY:-}
      - S3_SECRET_KEY=${S3_SECRET_KEY:-}
      - SESSION_SECRET=${SESSION_SECRET}
      - BASE_URL=${BASE_URL:-http://localhost:3000}
      - SESSION_COOKIE_SECURE=${SESSION_COOKIE_SECURE:-false}
    volumes:
      - data:/data
    depends_on:
      - redis
      - postgres

  worker:
    build: .
    command: node worker/index.mjs
    environment:
      - DATABASE_URL=${DATABASE_URL:-postgresql://megatest:megatest@postgres:5432/megatest}
      - REDIS_URL=redis://redis:6379
      - STORAGE_BACKEND=${STORAGE_BACKEND:-local}
      - STORAGE_PATH=/data/storage
      - S3_BUCKET=${S3_BUCKET:-}
      - S3_ENDPOINT=${S3_ENDPOINT:-}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY:-}
      - S3_SECRET_KEY=${S3_SECRET_KEY:-}
      - WORKER_CONCURRENCY=${WORKER_CONCURRENCY:-2}
      - DOCKER_HOST=${DOCKER_HOST:-unix:///var/run/docker.sock}
    volumes:
      - data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      - redis
      - postgres

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=megatest
      - POSTGRES_PASSWORD=megatest
      - POSTGRES_DB=megatest
    volumes:
      - pg-data:/var/lib/postgresql/data

volumes:
  data:
  redis-data:
  pg-data:
```

### 5.2 Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_APP_ID` | Yes | -- | GitHub App ID (numeric) |
| `GITHUB_PRIVATE_KEY` | Yes | -- | GitHub App private key (PEM). Used to sign JWTs for installation token requests. |
| `GITHUB_CLIENT_ID` | Yes | -- | GitHub App OAuth client ID |
| `GITHUB_CLIENT_SECRET` | Yes | -- | GitHub App OAuth client secret |
| `GITHUB_WEBHOOK_SECRET` | Yes | -- | Secret for validating GitHub webhook payloads |
| `SESSION_SECRET` | Yes | -- | Secret for signing session cookies |
| `BASE_URL` | No | `http://localhost:3000` | Public URL of the Megatest instance |
| `API_PORT` | No | `3000` | Port the API server listens on |
| `DATABASE_URL` | No | `postgresql://megatest:megatest@postgres:5432/megatest` | PostgreSQL connection string. Self-hosted deployments use the included PostgreSQL container by default. |
| `REDIS_URL` | No | `redis://redis:6379` | Redis connection URL |
| `STORAGE_BACKEND` | No | `local` | `local` or `s3` |
| `STORAGE_PATH` | No | `/data/storage` | Local filesystem path for screenshots (when backend=local) |
| `S3_BUCKET` | No | -- | S3 bucket name (when backend=s3) |
| `S3_ENDPOINT` | No | -- | S3-compatible endpoint URL |
| `S3_ACCESS_KEY` | No | -- | S3 access key |
| `S3_SECRET_KEY` | No | -- | S3 secret key |
| `WORKER_CONCURRENCY` | No | `2` | Max parallel test runs per worker |
| `DOCKER_HOST` | No | `unix:///var/run/docker.sock` | Docker daemon socket |
| `SESSION_COOKIE_SECURE` | No | `false` on localhost | Set `true` behind HTTPS. Allows local self-hosted login on `http://localhost`. |

---

## 6. Network Topology

The critical network relationship is between the worker runtime
(Playwright + Chromium + worker process) and the user's application
container.

```
Worker Runtime (host process or worker service container)
├── Playwright (Node.js)
│   └── controls headless Chromium
│       └── navigates to http://megatest-run-{id}:{APP_PORT}
│
├── Per-run Docker network
│   ├── worker runtime joined as client
│   └── user app container joined as server
│
└── User app container
    └── App server listening on {APP_PORT}
```

### Flow

1. Worker creates a dedicated Docker bridge network for the run.
2. Worker starts the user app container on that network with a stable alias
   such as `megatest-run-{id}`.
3. Worker waits for a health check on the configured `serve.ready` URL,
   rewritten to the container alias on the run network.
4. Worker launches Playwright pointing at the rewritten URL.
5. Playwright executes the steps from `.megatest/` config: navigating pages, interacting with elements, capturing screenshots.
6. On completion (or timeout), the worker removes the container and the per-run
   network.

### Security Boundaries

| Boundary | Mechanism |
|---|---|
| User code cannot accept public inbound traffic | The app container is attached only to a per-run private Docker network |
| User code cannot reach other runs | Each run uses its own isolated bridge network |
| Worker/browser is isolated from user filesystem | User code runs in a separate container with only the mounted repo path |
| Playwright cannot be hijacked | It connects outbound to the app container; no public listener is exposed |
| Runs are ephemeral | Container is `--rm`; filesystem is destroyed on exit |

MVP note: outbound egress from the app container is allowed during setup and
dependency installation so common commands such as `apt-get`, `npm ci`, and
`pip install` work. A hardened no-egress mode is a future enhancement rather
than an MVP guarantee.
