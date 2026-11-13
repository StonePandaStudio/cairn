<!-- cairn preset: spring — fills {{> stack/plan-step-ordering }} in the core
     architect's Plan format. Not concatenated across stack entries — one coherent
     sequence, taken from the primary stack (stack[0]). It assumes an ORM in step 1;
     a bare `--stack spring` repo trims that step. -->
1. Migration and entity / DAO changes
2. Service — domain logic, transaction and locking boundary
3. DTOs and domain exceptions
4. Controller — endpoint and security routing
5. Error handling and edge cases
6. Unit tests (`buildSut` pattern) and integration hooks
7. Context doc updates
