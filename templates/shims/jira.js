#!/usr/bin/env node
'use strict';

// Shim. The Jira client itself lives in @stonepanda/cairn — this file exists so
// that the ~40 references to `node ai/scripts/jira.js <command>` scattered across
// agent docs, command stubs and WORKFLOW.md keep working unchanged.
//
// Every command name and every output format is preserved by the CLI it calls.
// When those documents are regenerated (v2), they will point at `cairn tracker`
// directly and this shim goes away.

require('@stonepanda/cairn/tracker/cli')(process.argv.slice(2));
