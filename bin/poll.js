#!/usr/bin/env node

require('../index').envCheck();
require('../lib/poll')(
  'http://169.254.169.254/latest/meta-data/spot/termination-time',
  process.env.terminationTimeout,
  process.env.TerminationOverrideFunction,
  function(err) { if (err) throw err; }
);
