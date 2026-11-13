<!-- cairn preset: docker — appended to the framework preset's review-checklist
     slot on `--stack <framework>,docker`. -->

| Base Compose file has no `build:` and no host `ports:`; those live in the dev/prod overrides | `docker-compose*.yml` |
| Debug ports and admin tools appear only in the dev override | `docker-compose*.yml` |
| Base images pinned to an explicit version (no `latest`), behind the registry `ARG` | Dockerfiles |
| Prod image is multi-stage and self-contained; dev image carries no build toolchain | `Dockerfile-prod` / `Dockerfile-dev` |
| Dependency manifests copied and installed before sources (layer cache); lockfile install | Dockerfiles |
| Startup ordered by `healthcheck` + `depends_on` conditions; migrations run as a one-shot service the app waits on | `docker-compose.yml` |
| No secrets or credentials in images, build args or committed files; required variables use `${VAR:?…}` | Compose, Dockerfiles, `.env.example` |
| New or changed variable added to `.env.example` and the documented variable table | `.env.example`, docs |
| Host ports are `${PORT_X:-default}` variables; services reach each other by service name | `docker-compose*.yml` |
| Wrapper scripts `exec` the main process; logs go to stdout/stderr | Dockerfiles, entrypoints |
| `.dockerignore` present for each build context | build contexts |
