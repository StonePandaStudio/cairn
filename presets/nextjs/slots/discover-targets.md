<!-- cairn preset: nextjs — fills {{> stack/discover-targets }} (D.2). Adds the
     server side of the App Router to the react slot. -->
**Routes** (`ai/contexts/pages/`): one per `page.tsx` segment, noting which parts are
server components and which are `"use client"`.

**Server surface** (`ai/contexts/features/`): route handlers (`route.ts`) and server
actions, one doc per resource they serve. Sections: *Endpoints or actions*, *Auth*,
*Validation*, *Revalidation* (tags and paths it invalidates).
