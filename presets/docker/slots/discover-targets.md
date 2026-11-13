<!-- cairn preset: docker — fills {{> stack/discover-targets }} (D.2). Concatenated
     with the framework and ORM slots. -->
**Environments** (`ai/contexts/features/`): one for the container stack. Sections:
*Services* (name, image or Dockerfile, role, dev vs. prod differences), *Startup order*
(healthchecks and `depends_on` conditions), *Configuration* (every environment variable —
default, required or not, which service reads it), *Ports and volumes*, *Edge* (what is
published, how the proxy and any path prefix are wired).
