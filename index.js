var AWS = require('aws-sdk');
var scan = require('./lib/scan');
var adjust = require('./lib/adjust');
var cfn = require('./lib/cfn');


module.exports = {
  envCheck: envCheck,
  spotswap: spotswap,
  cfn: cfn
};

function envCheck() {
  [
    'OnDemandGroup',
    'INSTANCE_ID',
    'AWS_REGION'
  ].forEach(function(key) {
    if (!process.env[key]) throw new Error('Env var ' + key + ' is required');
  });
  if (!process.env.SpotGroup && !process.env.SpotFleet) throw new Error('One of SpotGroup or SpotFleet required.');
  if (process.env.SpotGroup && process.env.SpotFleet) throw new Error('May only have one of SpotGroup or SpotFleet.');
}

/**
 * Execute spotswap behavior:
 * 1. List instances in spot ASG or Fleet with SpotTermination tag
 * 2. Read current state of on-demand ASG configuration
 * 3. Increment DesiredCapacity of on-demand group
 *    by the # of instances marked for termination
 * 4. Remove tags from tagged instances
 *
 * @param {object} event - environment information sent from another lambda
 * @param {object} context - lambda context object
 * @param {Function} callback
 */
function spotswap(event, context, callback) {
  AWS.config.update({ region: process.env.AWS_REGION });

  scan()
    .then(instances => instances.length ? adjust.up(instances) : adjust.down())
    .then(() => callback())
    .catch(callback);
}
