<!-- cairn preset: angular — fills {{> stack/discover-targets }} (D.2). -->
**Pages** (`ai/contexts/pages/`): one per routed screen (the route config's lazy-loaded
components). Sections: *Route*, *Data* (services and API calls it makes), *States*
(loading, empty, error), *Permissions*.

**Features** (`ai/contexts/features/`): one per feature folder that several pages share
(forms, tables, dialogs, state stores). Sections: *Purpose*, *Public API* (inputs,
outputs, injected services), *Used by*.
