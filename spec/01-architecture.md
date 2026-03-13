# Megatest Architecture Specification

## 1. System Overview

Megatest is a visual regression testing SaaS. It connects to a user's GitHub repository, spins up their web application inside an isolated Docker container, then uses a headless browser to navigate the app, capture screenshots, and compare them against approved baselines. When pixels differ beyond a configured threshold, the run fails and a diff image is produced.

The core workflow:

1. A GitHub webhook (push or PR) triggers a test run.
2. The API server enqueues a job.
3. A worker picks up the job, clones the repo, builds and starts the app in a Docker container.
4. `agent-browser` (running on the worker host) connects to the containerized app and executes the test steps defined in `.megatest/`.
5. Screenshots are captured, diffed against baselines with `pixelmatch`, and results are stored.
6. Status is reported back to the GitHub commit/PR.

A secondary flow -- the Discovery Agent -- uses an AI model to explore a running app, discover its workflows, and generate the `.megatest/` config files automatically. Users do not hand-write config.

---

## 2. Component Diagram

```
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
│  │ agent-browser │───►│  Docker Container  │    │  pixelmatch  │  │
│  │ (Chromium)    │    │  (user app on      │    │  (diffing)   │  │
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
                    │    Database     │
                    │ (SQLite / PG)   │
                    └─────────────────┘


Discovery Agent Flow:
─────────────────────
  User triggers discovery
         │
         ▼
  ┌──────────────┐     ┌───────────────────┐
  │ Discovery    │────►│  Docker Container  │
  │ Agent (AI)   │     │  (user app)        │
  │ + agent-     │◄────│                    │
  │   browser    │     └───────────────────┘
  └──────┬───────┘
         │ generates
         ▼
  ┌──────────────┐
  │ .megatest/   │  ──► committed to repo via PR
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
| Worker | Node.js process on host | Orchestrates container lifecycle, runs agent-browser, runs pixelmatch |
| Browser Automation | `agent-browser` CLI (Rust, v0.17.1) | Headless Chromium control via semantic locators (`find testid`, `find role`, `find text`, `find label`) and element refs (`@e1`) |
| Image Diffing | `pixelmatch` (npm) | Pixel-level screenshot comparison, produces diff images |
| User App Isolation | Docker (one container per run) | Sandboxed execution of user code |
| Database | SQLite (single-node) / PostgreSQL (scaled) | Stores runs, projects, baselines, users, orgs |
| Storage | Local filesystem or S3-compatible | Stores screenshot PNGs, baseline images, diff images |
| Auth | GitHub OAuth | Multi-tenant login, repo-scoped access |
| Config | `.megatest/` directory in repo | Test definitions, viewport settings, thresholds -- AI-generated |
| Discovery Agent | AI model + agent-browser | Explores running app, discovers workflows, generates `.megatest/` config |

---

## 4. Key Design Decisions

### 4.1 agent-browser for browser automation

`agent-browser` is a Rust-based headless browser CLI by Vercel Labs. It is chosen over Playwright/Puppeteer because:

- Semantic locators (`find testid`, `find role`, `find text`, `find label`) map naturally to how an AI agent reasons about a page, making Discovery Agent output more robust.
- Element refs (`@e1`, `@e2`) from snapshots provide a stable addressing scheme within a session.
- Single statically-linked binary, no Node.js browser dependency management.
- Installed globally on the worker host -- not bundled per-project.

### 4.2 Docker per run for worker isolation

User application code is untrusted. Each run gets a fresh Docker container that:

- Is destroyed after the run completes (no state leakage between runs).
- Has no network access except the exposed port on localhost.
- Runs with resource limits (CPU, memory, timeout).

`agent-browser` and Chromium run on the **host**, not inside the container. The container only runs the user's app server and exposes a port.

### 4.3 pixelmatch for image diffing

`pixelmatch` is a small, fast, dependency-free library for pixel-level image comparison. It is used instead of agent-browser's built-in capabilities because:

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

### 4.6 SQLite / PostgreSQL for database

SQLite for single-node self-hosted deployments (zero config, no extra process). PostgreSQL for any deployment needing concurrent writers or horizontal scaling. The application uses a thin data-access layer that abstracts the dialect.

### 4.7 `.megatest/` directory (not a single YAML file)

Config is split across multiple files inside `.megatest/` so that:

- An AI agent (Discovery Agent or external LLM) can read/write individual files without loading the entire config.
- Individual test workflows can be added, removed, or modified independently.
- Merge conflicts are minimized.

Users do not write these files. The Discovery Agent generates them.

### 4.8 Embedded SPA for Web UI

The Web UI is served directly by the Fastify API server (no separate frontend deployment). Vanilla JS or Preact keeps the bundle small and avoids a build toolchain dependency for the UI.

---

## 5. Deployment Model

Self-hosted deployment uses Docker Compose with three services.

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
      - DATABASE_URL=${DATABASE_URL:-sqlite:./data/megatest.db}
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
    volumes:
      - data:/data
    depends_on:
      - redis

  worker:
    build: .
    command: node worker/index.mjs
    environment:
      - DATABASE_URL=${DATABASE_URL:-sqlite:./data/megatest.db}
      - REDIS_URL=redis://redis:6379
      - STORAGE_BACKEND=${STORAGE_BACKEND:-local}
      - STORAGE_PATH=/data/storage
      - S3_BUCKET=${S3_BUCKET:-}
      - S3_ENDPOINT=${S3_ENDPOINT:-}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY:-}
      - S3_SECRET_KEY=${S3_SECRET_KEY:-}
      - WORKER_CONCURRENCY=${WORKER_CONCURRENCY:-2}
      - DOCKER_HOST=${DOCKER_HOST:-unix:///var/run/docker.sock}
      - AGENT_BROWSER_PATH=${AGENT_BROWSER_PATH:-/usr/local/bin/agent-browser}
    volumes:
      - data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

volumes:
  data:
  redis-data:
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
| `DATABASE_URL` | No | `sqlite:./data/megatest.db` | Database connection string. Use `postgresql://...` for PG. |
| `REDIS_URL` | No | `redis://redis:6379` | Redis connection URL |
| `STORAGE_BACKEND` | No | `local` | `local` or `s3` |
| `STORAGE_PATH` | No | `/data/storage` | Local filesystem path for screenshots (when backend=local) |
| `S3_BUCKET` | No | -- | S3 bucket name (when backend=s3) |
| `S3_ENDPOINT` | No | -- | S3-compatible endpoint URL |
| `S3_ACCESS_KEY` | No | -- | S3 access key |
| `S3_SECRET_KEY` | No | -- | S3 secret key |
| `WORKER_CONCURRENCY` | No | `2` | Max parallel test runs per worker |
| `DOCKER_HOST` | No | `unix:///var/run/docker.sock` | Docker daemon socket |
| `AGENT_BROWSER_PATH` | No | `/usr/local/bin/agent-browser` | Path to agent-browser binary on host |

---

## 6. Network Topology

The critical network relationship is between `agent-browser` (on the worker host) and the user's application (inside a Docker container).

```
Worker Host
├── agent-browser process
│   └── controls embedded Chromium
│       └── navigates to http://127.0.0.1:{DYNAMIC_PORT}
│
├── Docker Container (--network=host is NOT used)
│   ├── User app server (e.g., Next.js on port 3000 inside container)
│   └── Container port 3000 → mapped to host 127.0.0.1:{DYNAMIC_PORT}
│
└── No external network access from container
```

### Flow

1. Worker selects an unused host port (e.g., `47321`) from an ephemeral range.
2. Worker starts the Docker container with `-p 127.0.0.1:47321:3000` (binding only to loopback -- the user app is never exposed to the network).
3. Worker waits for a health check on `http://127.0.0.1:47321` to confirm the app is ready.
4. Worker launches `agent-browser` pointing at `http://127.0.0.1:47321`.
5. `agent-browser` executes the steps from `.megatest/` config: navigating pages, taking snapshots, capturing screenshots.
6. On completion (or timeout), the worker stops and removes the Docker container.

### Port Allocation

Each concurrent run gets a unique port. The worker maintains a simple port pool (e.g., `47300-47399` for `WORKER_CONCURRENCY=2` gives ample headroom). Ports are released back to the pool when the container is destroyed.

### Security Boundaries

| Boundary | Mechanism |
|---|---|
| User code cannot reach the internet | Container started with `--network=none` + a port publish on loopback only (Docker allows `-p` with `--network=none` is invalid, so a custom bridge with no external routing is used) |
| User code cannot reach other containers | Each run uses its own isolated bridge network |
| User code cannot reach host services | Loopback binding is one-directional; the container's network namespace does not include the host's loopback |
| agent-browser cannot be hijacked | It connects outbound to the container port; no inbound listening port is exposed |
| Runs are ephemeral | Container is `--rm`; filesystem is destroyed on exit |
