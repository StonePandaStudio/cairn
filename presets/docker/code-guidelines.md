# Docker Guidelines

<!-- cairn preset: docker. Infrastructure add-on — orthogonal to the framework, ORM and
     styling axes. Compose it after the framework: `--stack spring,jpa-flyway,docker`,
     `--stack nestjs,typeorm,docker`. Seeded 2026-11-13 from one repo (a Compose stack of
     DB + migrations + backend + static frontend). Single consumer; refine when a second
     Docker repo appears.

     Not in it: the repo's service list, ports, image names, secrets, reverse-proxy rules
     and base-image versions. Those are project-owned. This preset says how the files are
     *split*, how startup is *ordered*, and how configuration *flows in*. Kubernetes,
     Swarm and registry/CI publishing are out of scope. -->

## File layout

* Three Compose files at the repo root: `docker-compose.yml` (base — everything common), `docker-compose-dev.yml` (dev overrides), `docker-compose-prod.yml` (prod overrides). Run as `docker compose -f docker-compose.yml -f docker-compose-<env>.yml …`.
* Each buildable service has its own folder with `Dockerfile-dev` and `Dockerfile-prod` (not a single parameterised file) — the two environments differ in kind, not in a flag.
* The base file names services, images, networks, volumes, environment and `depends_on`. It contains **no** `build:` and **no** host `ports:`; the env files add them.
* Wrap the long commands in a `Makefile` (`dev-up`, `dev-down`, `dev-logs`, `prod-up`, `prod-make`, `clean`, …) and pin the Compose project name (`-p "$(COMPOSE_PROJECT)"`) so container, volume and network names are stable across machines.

## Dev vs prod

| | Dev | Prod |
|---|---|---|
| Source | Built **on the host**; artifact (jar, `dist/`) is **mounted** into a thin runtime image | Copied into a **multi-stage** build; image is self-contained |
| Image | Runtime only (JRE, nginx) — no build tools | Builder stage discarded; runtime stage only |
| Config files | Mounted read-only (`:ro`) so edits apply on restart | Baked in |
| Debug | Debug port exposed, extra verbose profile | Off |
| Admin tools | DB web UI etc. allowed | Absent |
| Host ports | Published for every service you need to poke | Only the public entry point |

* Dev mounts are read-only unless the container must write.
* Admin tools and debug ports exist **only** in the dev override — never in base or prod.
* Prod images must run with no mounts and no host toolchain.

## Dockerfiles

* Pin base images to an explicit version (`eclipse-temurin:21-jre`, `nginx:1.28.1-alpine`) — never `latest`. Expose a `ARG DOCKERHUB=docker.io` (or similar) in front of every `FROM` so a mirror can be substituted.
* Multi-stage for prod: `builder` stage compiles; the final stage copies only the artifact. Copy dependency manifests first (`package.json` + lockfile, Gradle files), install, then copy sources, so the dependency layer caches.
* Use the lockfile install (`npm ci`), not `npm install`.
* Keep the process in the foreground as PID 1 and `exec` the real command in any wrapper script, so signals reach it.
* No secrets in images or build args. Nothing sensitive in a layer, even one that is later deleted.
* `EXPOSE` the container port; host mapping is a Compose concern.
* Add a `.dockerignore` per build context (`build`, `node_modules`, `.git`, `.env`).

## Startup order and migrations

* **Order by readiness, not by start**: a dependency declares a `healthcheck`; dependents use `depends_on: { <svc>: { condition: service_healthy } }`.
* Database migrations are a **separate run-to-completion service** (`restart: "no"`). The app depends on it with `condition: service_completed_successfully`. The app never runs DDL itself.
* The migration service depends on the DB being healthy and shares the same credentials as the app, passed through environment variables.
* Add an application-level connection retry as a second line of defence — Compose ordering does not cover a DB that restarts later.
* Long-lived services use `restart: unless-stopped`; one-shot services use `restart: "no"`.

## Configuration

* All configuration reaches a container through **environment variables** set in Compose. Defaults live in the Compose files (`${DB_NAME:-appname}`); `.env` (git-ignored) or the host environment overrides them.
* Ship a committed **`.env.example`** listing every variable, with local-dev-only values clearly marked. `.env` is in `.gitignore`.
* A variable the stack cannot run without has **no default** and fails fast with a message: `${PUBLIC_BASE_URL:?PUBLIC_BASE_URL must be configured}`. Secrets (signing keys, passwords for real environments) take this form; a default password is acceptable only for the local database.
* Host ports are variables with defaults (`"${PORT_FRONTEND:-50000}:80"`), so two checkouts can run side by side.
* One bridge network per project; one named volume per stateful service. Services reach each other by service name, never by published host port.
* Document the variable table (name, default, purpose) in the repo's architecture doc and keep it in step with the Compose files.

## Networking and edge

* Publish as few host ports as possible. In prod, one entry point (the static-frontend nginx or a gateway) fronts the stack and proxies API calls to the backend over the internal network; the backend and DB are not published.
* A real reverse proxy / TLS terminator belongs to the deployment, outside this stack. If the app can be served under a sub-path, pass the prefix as one variable (`APP_LOCATION_PREFIX`) consumed by the proxy config template **and** the backend's public-URL setting, and keep the two consistent.
* Proxy configuration is a template rendered from environment at container start (nginx `templates/` + an entrypoint script), not baked-in hostnames.

## Logging and operations

* Log to stdout/stderr only; read with `docker compose logs`. No log files inside containers.
* Do not add centralised logging, metrics stacks or orchestration to the stack unless the project asks for it.
* Image tags are `<project>/<service>:latest` for local builds; a `clean` target removes them. Version tagging for a registry is a separate concern.
* A change that touches the stack is verified by bringing it up (`make dev-up` / `prod-up`) and checking the service is healthy and reachable, not only by building.
