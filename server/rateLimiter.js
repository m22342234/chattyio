'use strict';

const { RateLimiterMemory } = require('rate-limiter-flexible');

// Dev mode uses a permissive limit so repeated connection attempts during
// development don't silently exhaust the window and block the IP.
// Production keeps the tight 3/60s guard.
const IS_DEV = process.env.NODE_ENV !== 'production';

const socketRateLimiter = new RateLimiterMemory({
  points:   IS_DEV ? 200 : 3,
  duration: 60,
});

module.exports = { socketRateLimiter };
