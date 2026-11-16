'use strict';

// A problem with what the user gave cairn (a malformed config, a missing file), as opposed to
// a bug. The CLI prints the message on one line and exits 2, with no stack trace.
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.userError = true;
  }
}

// "Go back one step": thrown by a prompt when the user presses Esc (or types `<` on a pipe). A flow
// built from steps (lib/wizard/steps.js) catches it and re-asks the previous step; at the first step
// it leaves the flow, and the menu above it catches it in turn. Not an error to report.
class Back extends Error {
  constructor() {
    super('back');
    this.name = 'Back';
    this.isBack = true;
  }
}

module.exports = { UserError, Back };
