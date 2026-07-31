'use strict';

// Programmatic surface. The CLI is a thin wrapper over this, and the workflow
// runner that lands in v2 will consume it directly rather than shelling out.

const config = require('./config');
const manifest = require('./manifest');
const tracker = require('./tracker');
const doctor = require('./doctor');
const init = require('./init');

module.exports = {
  ...config,
  manifest,
  tracker,
  doctor,
  init,
  createTracker: tracker.createTracker,
  trackerForRepo: tracker.trackerForRepo,
};
