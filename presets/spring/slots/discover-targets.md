<!-- cairn preset: spring — fills {{> stack/discover-targets }} (D.2). Concatenated
     with the ORM slot. -->
**Domains** (`ai/contexts/features/`): one per `domain/<area>/` package that has its own
controller or service. Sections: *Endpoints* (method, path, required authority), *Business
rules*, *Collaborators* (other services, managers and external systems it calls),
*Errors* (the `AppException` subclasses it throws, with codes).

**Cross-cutting** (`ai/contexts/features/`, named for the concern): security routing and
token types, `BaseController` exception handling, scheduled jobs, audit,
configuration profiles — if the repo has them.
