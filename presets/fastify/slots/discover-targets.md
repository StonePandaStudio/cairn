<!-- cairn preset: fastify — fills {{> stack/discover-targets }} (D.2). Concatenated
     with the ORM slot. -->
**Features** (`ai/contexts/features/`): one per Fastify plugin that registers routes
(`src/plugins/<name>/index.ts` and its `routes/`). Sections: *Endpoints* (method, path,
auth, feature flag), *Business rules* (from its `services/`), *Collaborators* (other
plugins, `lib/` modules and external services it calls).

**Cross-cutting** (`ai/contexts/features/`, named for the concern): auth and role guards,
the global error handler and domain error classes, config and feature flags, request
logging and redaction, and any non-HTTP entry point (Lambda handlers, schedulers, queue or
event consumers), if the repo has them.
