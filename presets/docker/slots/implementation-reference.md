<!-- cairn preset: docker — appended to the framework preset's implementation-reference
     slot on `--stack <framework>,docker`. -->

### Docker
- Compose split: `docker-compose.yml` (common, no `build:`/host `ports:`), `-dev.yml`, `-prod.yml`; run with `-p <project> -f base -f env`
- Per-service `Dockerfile-dev` (thin runtime, mounted artifact) and `Dockerfile-prod` (multi-stage, self-contained)
- Pin image versions; `ARG DOCKERHUB` before `FROM`; lockfile installs; `exec` in wrapper scripts
- Order by readiness: `healthcheck` + `depends_on … service_healthy`; migrations = one-shot service, app waits for `service_completed_successfully`
- Config only via env vars; defaults in Compose, required ones `${VAR:?message}`; update `.env.example` and the variable table
- Debug ports and admin tools only in the dev override; ports via `${PORT_X:-default}`
- Log to stdout; verify by bringing the stack up and checking health
