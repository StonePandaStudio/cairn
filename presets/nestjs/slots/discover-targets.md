<!-- cairn preset: nestjs — fills {{> stack/discover-targets }} (D.2). Concatenated
     with the ORM slot. -->
**Features** (`ai/contexts/features/`): one per Nest module with its own controller or
resolver (`*.module.ts`, `*.controller.ts`). Sections: *Endpoints* (method, path, auth),
*Business rules*, *Collaborators* (other modules and external services it calls).

**Cross-cutting** (`ai/contexts/features/`, named for the concern): auth and guards,
global pipes and filters, config, queues or schedulers, if the repo has them.
