# Hosted SynaptiCob

## Publish

Source repository: https://github.com/dawson-fleck/synapticob

Create a Render Blueprint from `render.yaml`. The configuration selects one Docker
web service on the **free** plan, in Ohio, with `/api/health` as its readiness check.
No database service, paid disk or paid compute plan is requested. Automatic deploys
are disabled so a code push does not interrupt a class without an explicit deploy.

Render supplies `RENDER_EXTERNAL_URL`. The app uses that exact HTTPS origin for
Host/Origin checks and secure cookies. For another host or a custom domain, set
`PUBLIC_ORIGIN` to the exact canonical HTTPS origin (no path); route students and
health checks through that origin. HTTPS is terminated by the hosting platform.
The container listens on `0.0.0.0:$PORT` through Gunicorn.

Wait for a successful deployment, open its returned HTTPS URL, run a scenario and
a drug lesson, switch tabs, play/scrub the neuron, and save an experiment ZIP.
Then try simultaneous browsers/devices before sharing the URL for a full class.
Do not substitute the repository URL or a `localhost` URL for the website URL.

## Operation

Use **one service instance and one Gunicorn worker**. `gunicorn.conf.py` provides
eight request threads; a separate semaphore admits one calculation/export at a
time by default. Busy requests receive a short `Retry-After` and an explanatory
message; the UI preserves the student's completed experiment for manual retry.
This prevents unlimited numerical jobs from exhausting a small server.

Each browser receives an unpredictable anonymous `Secure`, `HttpOnly`,
`SameSite=Lax` cookie. Students do not provide names or create accounts. SQLite
records belong to that session; another session cannot retrieve them. Results are
stored as NPZ arrays and JSON with `allow_pickle=False`. The engine, timesteps,
source hash and numerical-package provenance are preserved.

Default retention is the browser's latest **6 runs and 4 sweeps**, for **4 idle
hours**, with **64 MiB per session**, **128 active sessions**, and **1 GiB** total
stored payload. Reaching a global quota rejects new work and preserves existing
active students' results. Oldest results rotate only within their owner's session.
SQLite page allocation has a separate ceiling, so physical disk use can exceed
the payload quota but remains bounded. Session data is temporary and may disappear
on a restart, redeploy or free-service sleep. Download experiments before leaving.

The hosted workload limit is 20,000 time intervals per run and 150,000 aggregated
intervals per ordinary parameter sweep. Existing spatial-grid bounds still apply.
Oversized requests are rejected clearly; the app never coarsens a student's
timestep automatically. Defaults, drug lessons and a 7 x 7 default sweep fit these
limits. Drug response curves retain their existing model-specific limits.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PUBLIC_ORIGIN` | `RENDER_EXTERNAL_URL` | Exact canonical HTTPS origin |
| `PORT` | `10000` | Gunicorn listening port |
| `SYNAPTICOB_COMPUTE_SLOTS` | `1` | Concurrent calculations/exports, 1-4 |
| `SYNAPTICOB_CACHE_DIR` | Temporary `synapticob-hosted` folder | Ephemeral session store |
| `SYNAPTICOB_MAX_SESSIONS` | `128` | Maximum active anonymous sessions |
| `SYNAPTICOB_SESSION_TTL_SECONDS` | `14400` | Idle expiry |
| `SYNAPTICOB_SESSION_BYTES` | `67108864` | Session payload limit |
| `SYNAPTICOB_CACHE_BYTES` | `1073741824` | Total payload limit |
| `SYNAPTICOB_MAX_INTERVALS` | `20000` | Per-run time-interval limit |

Increase capacity vertically first, after measuring the intended class workload.
Multiple workers or horizontally scaled instances require shared session/storage
coordination and are not supported by this configuration. Public abuse protection
at the hosting edge may be needed for widespread distribution; resource quotas are
not a replacement for provider rate limiting.

## Reproducible deployment

The image uses Python `3.12.16-slim-bookworm`, the exact scientific versions in
`requirements.txt`, and Gunicorn `27.0.0`. It runs as a non-root user. The Docker
context is restricted to application code, UI, requirements and scientific docs;
local environments, logs, build artifacts and credentials are excluded.

The numerical model is identical to the desktop source. Linux numerical equivalence
and performance must be checked on the deployed image; Windows-only passing tests
do not establish bit-for-bit results across operating systems. From a source checkout,
the public QA command is `python -m unittest discover -s tests -p test_hosted.py -v`
(tests are not included in the production image). Recorded results and
remaining limits are in `WEB_VERIFICATION.md`.

Reference documentation (checked November 12, 2026):

- https://render.com/docs/blueprint-spec
- https://render.com/docs/environment-variables
- https://render.com/docs/health-checks
- https://render.com/docs/free
- https://gunicorn.org/reference/settings/
