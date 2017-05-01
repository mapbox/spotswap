#!/usr/bin/env node

var fs = require('fs');
var path = require('path');
var queue = require('d3-queue').queue;
var exec = require('child_process').exec;
var envCheck = require('..').envCheck;

envCheck();

fs.writeFileSync('/etc/init/spotswap-poll.conf', fs.readFileSync(__dirname + '/../etc/spotswap-poll.conf'));

var q = queue(1);
q.defer(exec, 'ln -s $(pwd)/bin/poll.js /usr/bin/spotswap-poll', { cwd: path.resolve(__dirname + '/..') });
q.defer(exec, 'start spotswap-poll');
q.awaitAll(function(err) {
  if (err) throw err;
});
