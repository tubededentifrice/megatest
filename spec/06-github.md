# 06 - GitHub Integration

Megatest integrates with GitHub via a **GitHub App**. This is the only VCS provider for MVP. The GitHub App model supports multi-tenancy: each user or organization installs the App on their repositories, granting Megatest scoped access without personal access tokens.

---

## 1. GitHub App Configuration

### Permissions

**Repository permissions:**

| Permission      | Access | Purpose                                  |
|-----------------|--------|------------------------------------------|
| Contents        | Write  | Clone repos, read `.megatest/` config, create discovery PR branches/commits |
| Pull requests   | Write  | Post and update PR comments              |
| Commit statuses | Write  | Post check statuses on commits           |
| Metadata        | Read   | Required by GitHub for all Apps          |

**Account permissions:**

| Permission      | Access | Purpose                        |
|-----------------|--------|--------------------------------|
| Email addresses | Read   | Populate user profile on login |

### Subscribed Events

- `push` -- trigger runs on branch pushes
- `pull_request` -- trigger runs on PR open/update and merged-close promotion
- `installation` -- track App installs and uninstalls
- `installation_repositories` -- track repo access changes

### App Credentials

| Credential           | Purpose                                      | Storage              |
|----------------------|----------------------------------------------|----------------------|
| App ID               | Identifies the App in API calls              | Environment variable |
| Private key (PEM)    | Signs JWTs for installation token requests   | Environment variable or secret store |
| Client ID            | OAuth authorization requests                 | Environment variable |
| Client secret        | OAuth token exchange                         | Environment variable (secret) |
| Webhook secret       | Verifies webhook signatures                  | Environment variable (secret) |

### App URLs

| URL                  | Value                                    |
|----------------------|------------------------------------------|
| Webhook URL          | `{BASE_URL}/api/webhooks/github`         |
| OAuth callback URL   | `{BASE_URL}/auth/github/callback`        |
| Setup URL (optional) | `{BASE_URL}/auth/github/setup`           |

---

## 2. OAuth Flow

Megatest uses the GitHub App's built-in OAuth support for user authentication. This is distinct from OAuth Apps -- the App's client ID and secret are used, and permissions come from the App installation, not OAuth scopes.

### Flow

```
Browser                     Megatest Server                GitHub
  |                              |                           |
  |  GET /auth/github            |                           |
  |----------------------------->|                           |
  |                              | Generate state (CSRF)     |
  |                              | Store state in session    |
  |  302 Redirect                |                           |
  |<-----------------------------|                           |
  |                                                          |
  |  GET https://github.com/login/oauth/authorize            |
  |    ?client_id={CLIENT_ID}                                |
  |    &redirect_uri={BASE_URL}/auth/github/callback         |
  |    &state={STATE}                                        |
  |--------------------------------------------------------->|
  |                                                          |
  |  User authorizes the App                                 |
  |                                                          |
  |  302 → {BASE_URL}/auth/github/callback?code=...&state=..|
  |<---------------------------------------------------------|
  |                                                          |
  |  GET /auth/github/callback?code=...&state=...            |
  |----------------------------->|                           |
  |                              | Validate state            |
  |                              |                           |
  |                              | POST github.com/login/oauth/access_token
  |                              |   client_id, client_secret, code
  |                              |-------------------------->|
  |                              |   { access_token }        |
  |                              |<--------------------------|
  |                              |                           |
  |                              | GET api.github.com/user   |
  |                              |   Authorization: token .. |
  |                              |-------------------------->|
  |                              |   { id, login, email, ..} |
  |                              |<--------------------------|
  |                              |                           |
  |                              | GET api.github.com/user/emails
  |                              |   (if email not in /user) |
  |                              |-------------------------->|
  |                              |   [{ email, primary, ..}] |
  |                              |<--------------------------|
  |                              |                           |
  |                              | Upsert user record        |
  |                              | Set HTTP-only session     |
  |  302 → original page         |                           |
  |<-----------------------------|                           |
```

### Steps in Detail

1. **Initiate**: User visits `/auth/github`. Server generates a cryptographically random `state` parameter, stores it in the session, and redirects to GitHub.

2. **Authorize**: User sees the GitHub App authorization prompt. No scopes are requested -- permissions are defined by the App manifest.

3. **Callback**: GitHub redirects to `/auth/github/callback` with `code` and `state` query parameters.

4. **Validate state**: Server compares the returned `state` to the stored session value. Reject with 403 if they do not match.

5. **Exchange code for token**:
   ```
   POST https://github.com/login/oauth/access_token
   Accept: application/json
   Content-Type: application/json

   {
     "client_id": "{CLIENT_ID}",
     "client_secret": "{CLIENT_SECRET}",
     "code": "{CODE}"
   }
   ```
   Response: `{ "access_token": "ghu_...", "token_type": "bearer" }`

6. **Fetch user profile**:
   ```
   GET https://api.github.com/user
   Authorization: token {ACCESS_TOKEN}
   ```
   Returns `id`, `login`, `name`, `email`, `avatar_url`.

   If `email` is null (user has private email), fetch:
   ```
   GET https://api.github.com/user/emails
   Authorization: token {ACCESS_TOKEN}
   ```
   Select the entry where `primary == true && verified == true`.

7. **Create or update user record**: Match on `github_id`. Store `github_login`, `email`, `name`, `avatar_url`. The user access token is stored encrypted for later API calls on behalf of the user.

7b. **Organization association:** If the user is new (not an existing record), check if they should be associated with an organization. If the user's GitHub account or any of their GitHub App installations match an existing org, add them as a member. If no matching org exists, create a new organization named after the user's GitHub login. The user becomes the `owner` of the new org.

8. **Set session**: Issue an HTTP-only, SameSite=Lax session cookie. Set
   `Secure` when `BASE_URL` is HTTPS; allow non-secure cookies only for local
   `http://localhost` / loopback development. Redirect to the page the user was
   on before login (stored in session or passed via `state`).

---

## 3. Installation Flow

GitHub App installation is handled entirely by GitHub's UI. Megatest learns about installations via webhooks.

### Flow

1. User navigates to the GitHub App page (e.g., `https://github.com/apps/megatest`) or clicks "Add to GitHub" from the Megatest UI.
2. User selects an account (personal or organization).
3. User selects repositories: all repos, or specific repos.
4. User clicks "Install".
5. GitHub sends an `installation.created` webhook to `{BASE_URL}/api/webhooks/github`.
6. Megatest stores the installation record (see section 4).
7. When the user returns to Megatest, they can connect repos from the installation as Megatest projects.

### Linking User to Installation

After installation, GitHub redirects the user to the setup URL if configured. The redirect includes `installation_id` as a query parameter. Megatest uses this to associate the current user's session with the installation, enabling the UI to show available repos immediately.

---

## 4. Webhook Events

All webhooks arrive at:

```
POST {BASE_URL}/api/webhooks/github
Content-Type: application/json
X-GitHub-Event: {event_name}
X-Hub-Signature-256: sha256={signature}
X-GitHub-Delivery: {delivery_id}
```

The server MUST verify the signature before processing any event (see section 5).

### 4.1 push

Triggered when commits are pushed to a branch.

**Extract from payload:**
- `repository.id` -- match to project
- `repository.full_name` -- `{owner}/{repo}`
- `ref` -- e.g., `refs/heads/main`
- `after` -- the head commit SHA
- `installation.id` -- for API access
- `sender.login` -- who pushed

**Processing:**

1. Parse branch name from `ref` (strip `refs/heads/`).
2. Find project by `github_repo_id = repository.id`.
3. If no matching project, ignore (respond 200).
4. Evaluate the project's trigger rules (see spec 13). Check if a trigger rule matches this `push` event for this branch. If no rule matches, ignore (respond 200, no run created).
5. Create a `run` record:
   - `project_id`: matched project
   - `trigger`: `"push"`
   - `commit_sha`: `after`
   - `branch`: parsed branch name
   - `status`: `"queued"`
6. Enqueue the run job.
7. Respond **202 Accepted** with `{ "run_id": "{id}" }`.

### 4.2 pull_request

Triggered on PR activity. Megatest acts on these actions: `opened`,
`synchronize`, `reopened`, and `closed` (for merged PR baseline promotion).

**Extract from payload:**
- `action` -- filter to `opened | synchronize | reopened | closed`
- `repository.id` -- match to project
- `repository.full_name` -- `{owner}/{repo}`
- `pull_request.number` -- PR number
- `pull_request.head.sha` -- commit to test
- `pull_request.head.ref` -- head branch name
- `pull_request.base.ref` -- base branch name
- `installation.id` -- for API access
- `sender.login` -- who opened/updated

**Processing:**

1. If `action` is not one of `opened`, `synchronize`, `reopened`, `closed`, ignore (respond 200).
2. Find project by `github_repo_id = repository.id`.
3. If no matching project, ignore (respond 200).
3b. Evaluate the project's trigger rules. Check if a trigger rule matches this `pull_request` event with this action. If no rule matches, ignore (respond 200, no run created). Note: `closed` with `merged=true` always proceeds regardless of trigger rules (baseline promotion must not be blocked by trigger config).
4. If `action = closed` and `pull_request.merged = true`:
   a. Trigger baseline promotion for the PR's most recent completed Megatest run.
   b. Enqueue a route detection job for the project to check for new uncovered routes in the merged changes (see spec 12). The job receives the merge commit SHA and the diff range (`base_sha...merge_sha`) for targeted file analysis.
   c. Respond 200.
5. If `action = closed` and `merged = false`, ignore (respond 200).
6. Otherwise create a `run` record:
   - `project_id`: matched project
   - `trigger`: `"pull_request"`
   - `commit_sha`: `pull_request.head.sha`
   - `branch`: `pull_request.head.ref`
   - `base_branch`: `pull_request.base.ref`
   - `pr_number`: `pull_request.number`
   - `status`: `"queued"`
7. Enqueue the run job.
8. Respond **202 Accepted** with `{ "run_id": "{id}" }`.

### 4.3 installation.created

Triggered when a user installs the GitHub App.

**Extract from payload:**
- `installation.id`
- `installation.account.id` -- GitHub user or org ID
- `installation.account.login` -- GitHub user or org login
- `installation.account.type` -- `"User"` or `"Organization"`
- `installation.permissions` -- granted permissions
- `repositories` -- array of `{ id, name, full_name }` (initial repo list)

**Processing:**

1. Create an `installation` record:
   - `github_installation_id`: `installation.id`
   - `github_account_id`: `installation.account.id`
   - `github_account_login`: `installation.account.login`
   - `account_type`: `installation.account.type`
   - `status`: `"active"`
2. For each repository in `repositories`, store in `installation_repositories`:
   - `github_installation_id`: `installation.id`
   - `github_repo_id`: `repo.id`
   - `repo_full_name`: `repo.full_name`
3. Respond **200 OK**.

### 4.4 installation.deleted

Triggered when a user uninstalls the GitHub App.

**Extract from payload:**
- `installation.id`

**Processing:**

1. Mark the installation record as `status = "deleted"`.
2. Deactivate all projects linked to this installation (set `project.active = false`).
3. Cancel any queued runs for those projects.
4. Respond **200 OK**.

### 4.5 installation_repositories.added

Triggered when repos are added to an existing installation.

**Extract from payload:**
- `installation.id`
- `repositories_added` -- array of `{ id, name, full_name }`

**Processing:**

1. For each repository in `repositories_added`, insert into `installation_repositories`.
2. Respond **200 OK**.

### 4.6 installation_repositories.removed

Triggered when repos are removed from an existing installation.

**Extract from payload:**
- `installation.id`
- `repositories_removed` -- array of `{ id, name, full_name }`

**Processing:**

1. For each repository in `repositories_removed`, remove from `installation_repositories`.
2. Deactivate any projects linked to those repos.
3. Cancel any queued runs for those projects.
4. Respond **200 OK**.

---

## 5. Webhook Signature Verification

Every webhook request from GitHub includes a signature header. Megatest MUST verify this before processing the payload.

### Algorithm

1. Read the raw request body as bytes (before any JSON parsing).
2. Compute HMAC-SHA256 using the webhook secret as the key:
   ```
   expected = HMAC-SHA256(webhook_secret, raw_body)
   ```
3. Extract the signature from the `X-Hub-Signature-256` header:
   ```
   X-Hub-Signature-256: sha256={hex_digest}
   ```
4. Compare `expected` to `hex_digest` using **timing-safe comparison** (e.g., `crypto.timingSafeEqual` in Node.js).
5. If they do not match, respond **401 Unauthorized** and log the attempt.

### Implementation Notes

- The raw body must be captured before any body-parsing middleware transforms it. In Express, use `express.raw({ type: 'application/json' })` on the webhook route, or use a verify callback in `express.json()`.
- The webhook secret is configured on both the GitHub App and in Megatest's environment variables.

---

## 6. Installation Access Tokens

To call GitHub's API on behalf of an installation (clone repos, post statuses, post comments), Megatest generates short-lived installation access tokens.

### Generating a JWT

The GitHub App authenticates as itself using a JWT signed with its private key.

```
Header:  { "alg": "RS256", "typ": "JWT" }
Payload: {
  "iat": {now - 60},       // issued at (60s in the past for clock drift)
  "exp": {now + 600},      // expires in 10 minutes (max)
  "iss": "{APP_ID}"        // GitHub App ID
}
```

Sign with the App's PEM private key using RS256.

### Requesting an Installation Token

```
POST https://api.github.com/app/installations/{installation_id}/access_tokens
Authorization: Bearer {JWT}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

Response:
```json
{
  "token": "ghs_...",
  "expires_at": "2024-01-01T01:00:00Z",
  "permissions": { "contents": "read", "pull_requests": "write", ... },
  "repository_selection": "selected"
}
```

### Caching

- Tokens are valid for **1 hour**.
- Cache tokens keyed by `installation_id`.
- Refresh when the token is within **5 minutes** of expiry.
- On 401 responses from GitHub API, invalidate the cached token and retry once with a fresh token.

### Token Permissions

Optionally scope the token to specific repositories and permissions:

```json
{
  "repositories": ["repo-name"],
  "permissions": {
    "contents": "read",
    "pull_requests": "write",
    "statuses": "write"
  }
}
```

For MVP, request with the full App permissions and do not scope to specific repos.

---

## 7. Commit Status Posting

Megatest posts commit statuses to indicate the state of visual regression checks. This integrates with GitHub's branch protection rules -- repos can require the "megatest" status to pass before merging.

### API Endpoint

```
POST https://api.github.com/repos/{owner}/{repo}/statuses/{sha}
Authorization: token {INSTALLATION_TOKEN}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

### Request Body

```json
{
  "state": "pending | success | failure | error",
  "target_url": "{BASE_URL}/review/{runId}",
  "description": "...",
  "context": "megatest"
}
```

### Status Mapping

| Run Status                | GitHub State | Description                                          |
|---------------------------|--------------|------------------------------------------------------|
| queued                    | `pending`    | `Megatest: running visual checks...`                 |
| running                   | `pending`    | `Megatest: running visual checks...`                 |
| completed, all checkpoints pass | `success` | `Megatest: {n} checkpoints passed` |
| completed, any failed or new checkpoints pending review | `failure` | `Megatest: review required for {n} failed/new checkpoints` |
| completed, all failed/new checkpoints later approved | `success` | `Megatest: all reviewable checkpoints approved` |
| failed (error in run) | `error` | `Megatest: run failed -- {error_message}` |

### When to Post

- **On run creation**: Post `pending`.
- **On run start** (worker picks up): Post `pending` (updates timestamp).
- **On run completion**: Post `success`, `failure`, or `error` based on results.
- **On approval**: When a user approves all diffs in a run, post `success`.

### Description Length

GitHub truncates descriptions at 140 characters. Keep descriptions concise.

---

## 8. PR Comment

Megatest posts a summary comment on pull requests with visual diff results. The comment is created once and updated on subsequent runs, avoiding comment spam.

### Finding Existing Comments

To find a previous Megatest comment on the PR, list all comments and search for the marker:

```
GET https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments
Authorization: token {INSTALLATION_TOKEN}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

Search response bodies for the HTML comment marker: `<!-- megatest:run:`.

Note: Use the Issues API for PR comments (not the Pull Request review comments API). PR comments are issue comments.

If pagination is needed, follow `Link` headers. In practice, scan the most recent comments first (use `?sort=created&direction=desc&per_page=100`).

### Creating a Comment

```
POST https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments
Authorization: token {INSTALLATION_TOKEN}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28

{
  "body": "{markdown}"
}
```

### Updating a Comment

```
PATCH https://api.github.com/repos/{owner}/{repo}/issues/comments/{comment_id}
Authorization: token {INSTALLATION_TOKEN}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28

{
  "body": "{markdown}"
}
```

### Comment Format

```markdown
## Megatest Visual Regression

| Status | Count |
|--------|-------|
| Passed | {passed_count} |
| Failed | {failed_count} |
| New    | {new_count} |

**{diff_count} screenshots differ from the baseline.**

[Review & approve changes]({BASE_URL}/review/{runId})

<details>
<summary>Changed checkpoints ({diff_count})</summary>

| Checkpoint | Diff |
|------------|------|
| {workflow} / {name} / {viewport} | {diff_percent}% |
| {workflow} / {name} / {viewport} | {diff_percent}% |
| ... | ... |

</details>

<!-- megatest:run:{runId} -->
```

**Variations:**

- **All passing, no diffs**: Omit the "Changed checkpoints" details block. Show a one-line success message.
- **New checkpoints (no baseline)**: Listed as "New" in the status table and
  treated as review-required. They do not produce GitHub `success` until
  explicitly approved.
- **Run failed**: Show error message instead of diff table.

### When to Post/Update

- On run completion (success or failure).
- On approval (update the comment to reflect approved status).

---

## 9. Baseline Promotion on Merge

When a PR is merged into the default branch, approved baselines from the PR are
promoted from the `pull_request.closed` webhook with `merged = true`.

### Trigger

Megatest does not infer merges from default-branch pushes. Promotion is driven
directly by the merged PR event because it is explicit and does not rely on
commit-message or merge-strategy heuristics.

### Promotion Logic

1. On `pull_request.closed` with `merged = true`, find the most recent
   `completed` run for that PR.
2. For each checkpoint in that run:
   - If the latest review action is **approve**, upsert the default-branch
     baseline with the checkpoint's actual image.
   - If the checkpoint **passed**, no action is needed.
   - If the latest review action is **reject**, do not promote.
   - If the checkpoint is `fail` or `new` with no approval, do not promote.
3. Record the promotion event for audit purposes.

### Edge Cases

- **No run found for PR**: Skip promotion. The PR may not have had Megatest configured.
- **Multiple runs for PR**: Use the most recent `completed` run for the PR head SHA at merge time when available, otherwise the most recent completed PR run.
- **Direct push to default branch**: Treat as a normal push. No promotion logic runs.

### Config Repo Awareness

When a project uses `config_storage_mode = 'config_repo'`, discovery PRs and auto-generated workflow updates target the config repository, not the main project repository. The main repo's `pull_request.closed` webhook still triggers baseline promotion and route detection as normal, but any resulting re-discovery PRs are created on the config repo.

---

## 10. Rate Limits

### GitHub API Rate Limits

| Authentication Method    | Limit                        |
|--------------------------|------------------------------|
| Installation token       | 5,000 requests/hour/install  |
| User-to-server token     | 5,000 requests/hour/user     |
| App JWT                  | 5,000 requests/hour/app      |

GitHub returns rate limit info in response headers:
```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4999
X-RateLimit-Reset: 1609459200
```

### Mitigation Strategies

1. **Cache installation tokens**: Generate once, reuse until near expiry (see section 6).

2. **Shallow clones**: When cloning repos to run tests, use:
   ```
   git clone --depth 1 --branch {branch} https://x-access-token:{token}@github.com/{owner}/{repo}.git
   ```
   This minimizes data transfer and avoids fetching full history.

3. **Batch status updates**: Do not post intermediate statuses excessively. Post `pending` once at run start, then the final status at completion.

4. **Respect Retry-After**: If GitHub returns 403 with a `Retry-After` header, back off for the specified duration.

5. **Secondary rate limits**: GitHub also enforces a concurrency/abuse limit. If the server returns 403 with `"retry-after"` in the response body, wait and retry with exponential backoff.

6. **Conditional requests**: Use `If-None-Match` / `ETag` headers where possible. Conditional requests that return 304 do not count against the rate limit.

7. **Monitor usage**: Log `X-RateLimit-Remaining` values. Alert if remaining drops below 10% of the limit.

---

## 11. Repository Cloning

Megatest needs to clone user repositories to execute visual test workflows.

### Clone URL

Use HTTPS with the installation token:
```
https://x-access-token:{installation_token}@github.com/{owner}/{repo}.git
```

### Clone Strategy

1. **Shallow clone** for the specific commit:
   ```bash
   git clone --depth 1 --branch {branch} \
     https://x-access-token:{token}@github.com/{owner}/{repo}.git \
     {work_dir}
   cd {work_dir}
   git checkout {sha}
   ```

2. If the branch and SHA are misaligned (e.g., force-push between webhook and clone):
   ```bash
   git fetch --depth 1 origin {sha}
   git checkout {sha}
   ```

3. Clone into a temporary directory. Clean up after the run completes.

### Security

- Never log the installation token.
- Use the token only for the duration of the clone operation.
- Run cloned code in an isolated environment (see execution spec).

---

## 12. Error Handling

### Webhook Delivery Failures

- GitHub retries webhook deliveries if Megatest responds with a 5xx or times out (10 seconds).
- Megatest should respond quickly (< 1 second) and enqueue heavy work asynchronously.
- Use the `X-GitHub-Delivery` header as an idempotency key to avoid processing duplicate deliveries.

### Token Errors

| Error                      | Action                                                |
|----------------------------|-------------------------------------------------------|
| 401 from installation API  | Installation may have been deleted. Mark as inactive.  |
| 403 rate limited           | Back off per `Retry-After` header.                    |
| 404 on repo                | Repo may have been deleted or access revoked. Skip.   |

### Webhook Processing Errors

- If processing a webhook fails after signature verification, log the error and respond 200 to prevent GitHub from retrying (retries would also fail).
- Exception: if the failure is transient (database unavailable), respond 500 to trigger a retry.
