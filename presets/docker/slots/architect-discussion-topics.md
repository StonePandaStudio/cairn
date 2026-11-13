<!-- cairn preset: docker — appended to the framework preset's architect-discussion-topics
     slot on `--stack <framework>,docker`. -->
- **Container impact** — does the change add a service, a port, a volume or an environment variable; is it dev-only or also prod
- **Startup ordering** — what the new service must wait for (healthy vs. completed), and whether a migration must run first
- **Configuration** — required (no default, fail fast) vs. defaulted variables; what `.env.example` and the variable table need
