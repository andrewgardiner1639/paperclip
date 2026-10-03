# Self-hosted Paperclip with cloud dispatch

These deployment templates and process bridges keep the application and its scheduler on a VPS. They do not change Paperclip's database schema or core adapters.

## Services

Build this fork's pinned release with `docker build --target production -t paperclip-fork:2026.1001.0 .` from the repository root. Deploy Paperclip, PostgreSQL 18 and Caddy using the three compose files. The database has no published port; the app port binds to loopback. Only Caddy publishes HTTP/HTTPS.

The templates expect `/opt/paperclip` on the server. Keep `database.env`, `deployment.env`, state, backups and credentials outside Git. Set `PAPERCLIP_HOSTNAME` and `PAPERCLIP_PUBLIC_URL` in the deployment environment. Start with `docker compose --env-file deployment.env -f compose.yaml -f compose-public.yaml -f compose-bridge.yaml up -d`. Set authenticated public mode and an explicit matching auth base URL in Paperclip's instance config. Create/sign in to a human account and use Paperclip's ownership claim to migrate a local workspace.

Restore a logical SQL dump, never a Windows PostgreSQL data directory. Copy assets, instructions and secret encryption material. Remap Windows paths. Preserve the destination's authenticated users and ownership when applying a later source snapshot. Suspend the source scheduler before enabling the destination scheduler. Provider snapshots supplement the included hourly logical database backup; retain and periodically test both.

## Codex Cloud process bridge

Use the existing Codex agent with process command `node`, argument `/integrations/run-codex-cloud.mjs`, timeout 3600, grace 10 and one concurrent run. Copy the matching runtime file into the mounted integrations directory. Supply these adapter environment entries:

- `PAPERCLIP_INTERNAL_API_URL=http://127.0.0.1:3100`
- `CODEX_CLOUD_ENV_ID`: the approved CLI-compatible repository environment ID
- `CODEX_CLOUD_BRANCH`: the deployment branch
- `CODEX_CLOUD_INSTRUCTIONS_FILE`: the migrated instruction entry file

Sign into Codex as the container's `node` user with `codex login --device-auth`. The operator completes OpenAI's approval. `HOME=/paperclip` stores renewable subscription authentication in the persisted state volume. Restrict the auth directory/file to owner access. Verify sign-in survives container recreation.

The bridge uses OpenAI's experimental `codex cloud exec` path. It persists uncertainty before submission and saves the returned cloud task ID. Subsequent execution resumes an outstanding task instead of submitting a duplicate. An uncertain submission without a task ID requires operator reconciliation. It reads results from the same task-detail transport used by the open-source Codex CLI; this experimental transport can change.

Results and the actual reported model are posted to the assigned Paperclip task, with a cloud history link. The bridge passes the task description, recent comments and bounded Markdown documents. Cloud runs cannot access local Windows files, desktop apps or desktop-only connectors. Do not enable business routines until their tools and credentials are verified in the cloud environment.

**Model limitation:** the CLI cloud path chooses its service default. A verified deployment test reported `gpt-5.6-sol`. This bridge does not enforce GPT-6.1 Sol or Paperclip's local per-task model overrides. Do not advertise model selection as working through this bridge.

## Existing Grok Bot callback bridge

The optional Grok service exposes only `/bot-bridge/jobs/<run-id>`. Each job requires an expiring bearer capability; it cannot enumerate tasks or access the Paperclip API. Identical result submissions are idempotent and conflicting results are rejected. The process runner retains the Paperclip run token and only returns results to its currently assigned company/task.

An existing bot's webhook routine must be changed to GET/POST the supplied `jobUrl` with `jobToken` through its hosted cloud computer. Preserve its existing approvals. A routine that still invokes Windows claim/finish commands cannot work while the laptop is off. Never activate the Grok agent until a real cloud callback test succeeds.

The runner expects an AES-256-GCM encrypted webhook credential at `/paperclip/integration-secrets/grok.json` and an owner-only 32-byte `master.key`. Those files are operator state and must never be committed. Set `PAPERCLIP_INTERNAL_API_URL` and `PAPERCLIP_PUBLIC_URL` in its adapter environment.

## Validation and upstream updates

Run `node --check` on the runtime scripts and `node --test grok-bridge.test.mjs` on Linux. Also verify an actual cloud task/result, a scheduled run, restart persistence, authenticated browser access, old document/run-log visibility and backups. The scoped HTTP test covers unauthorized/expired capabilities and idempotent/conflicting results; it is not a provider connection test.

Keep `origin` on the personal fork and `upstream` on `paperclipai/paperclip`. Inspect upstream release changes, back up the database and test a candidate upgrade before deployment. Merge a selected release into the deployment branch, rebuild the production image and run migrations through the app's supported startup path. Retain the prior image/database snapshot for rollback. Do not automatically merge upstream master into a running production database.
