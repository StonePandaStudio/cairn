<!-- cairn preset: react — fills {{> stack/discover-targets }} (D.2). -->
**Pages** (`ai/contexts/pages/`): one per routed screen. Sections: *Route*, *Data* (hooks
and API calls), *States* (loading, empty, error), *Permissions*.

**Features** (`ai/contexts/features/`): one per feature folder that several pages share
(forms, tables, stores, context providers). Sections: *Purpose*, *Public API* (props,
exported hooks), *Used by*.
