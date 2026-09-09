<!-- cairn preset: nestjs — fills {{> stack/plan-step-ordering }} in the core
     architect's Plan format. This slot is *not* concatenated across stack entries
     — it is one coherent sequence, taken from the primary stack (stack[0]). It
     assumes an ORM in step 1; a bare `--stack nestjs` repo trims that step.
     From node-architect.md. -->
1. Entity / migration changes
2. Feature module — service and repository setup
3. DTOs and validation decorators
4. API module — controller and endpoint implementation
5. Error handling and edge cases
6. Unit and integration test hooks
7. Context doc updates
