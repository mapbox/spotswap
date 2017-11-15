var request = require('request');
var AWS = require('aws-sdk');
var fastlog = require('fastlog')('spotswap-poll', 'info');
var fs = require('fs');
var os = require('os');
var path = require('path');

module.exports = poll;

/**
 * Poll spot termination endpoint and tag
 * an instance if it is marked for termination.
 *
 * Then terminate self gracefully, relying on ASG
 * lifecycle hook for any additional tasks (like
 * ECS instance deregistration).
 *
 * @param {String} endpoint - url of termination endpoint
 * @param {String} [lambdaArn] - the ARN for a lambda function to invoke instead
 * of terminating the instance
 * @param {Function} callback
 */
function poll(endpoint, terminationTimeout, lambdaArn, callback) {
  if (typeof lambdaArn === 'function') {
    callback = lambdaArn;
    lambdaArn = null;
  }

  terminationTimeout = !terminationTimeout ? 0 : terminationTimeout;
  AWS.config.update({ region: process.env.AWS_REGION });
  request(endpoint, function(err, res) {
    if (err) return callback(err);
    if (res.statusCode === 404) return callback();

    fastlog.info('Received termination notice: %s', res.body);
    if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(res.body)) {
      fastlog.info('termination-time mesage is present but not a timestamp, ignoring');
      return callback();
    }

    var ec2 = new AWS.EC2();
    var autoscaling = new AWS.AutoScaling();

    function done(err) {
      if (err) return callback(err);
      fs.writeFile(path.join(os.tmpdir(), 'give-up'), 'bye', callback);
    }

    fastlog.info('Tagging self with termination notice.');
    Promise.all([
      ec2.createTags({
        Resources: [process.env.INSTANCE_ID],
        Tags: [{ Key: 'SpotTermination', Value: 'true' }]
      }).promise(),
      module.exports.metadata()
    ]).then((results) => {

      // If an override function is specified, do that.
      if (lambdaArn) {
        fastlog.info('Invoking %s.', lambdaArn);
        var lambda = new AWS.Lambda({ region: lambdaArn.split(':')[3] });
        return lambda.invoke({
          FunctionName: lambdaArn,
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify({
            instanceId: process.env.INSTANCE_ID,
            availabilityZone: results[1].availabilityZone,
            instanceType: results[1].instanceType,
            caller: 'spotswap-poll',
            noTermination: true
          })
        }, done);

      // If the spot instance is in an autoscaling group, terminate it so that
      // any ELB connections will gracefully drain.
      // First wait for 90 seconds to give the tag-scanner a chance to pick
      // up and replace the instance.
      } else if (process.env.SpotGroup) {
        fastlog.info('Pausing for 90 seconds...');
        return setTimeout(function() {
          fastlog.info('Terminating self via TerminateInstanceInAutoScalingGroup');
          autoscaling.terminateInstanceInAutoScalingGroup({
            InstanceId: process.env.INSTANCE_ID,
            ShouldDecrementDesiredCapacity: false
          }, done);
        }, process.env.terminationTimeout);

      // If the spot instance is in a spot fleet, all we can do is terminate the
      // instance. It is unlikely that this would allow for graceful connection
      // draining.
      } else if (process.env.SpotFleet) {
        fastlog.info('Terminating self via TerminateInstances');
        return ec2.terminateInstances({
          InstanceIds: [process.env.INSTANCE_ID]
        }, done);

      // Anything else is misconfigured somehow
      } else {
        done();
      }
    }).catch(err => done(err));
  });
}

module.exports.metadata = function() {
  var base = 'http://169.254.169.254/latest/meta-data/';
  var data = { instanceId: process.env.INSTANCE_ID };

  return new Promise(function(resolve, reject) {
    request(base + 'instance-type', function(err, res) {
      if (err) return reject(err);
      if (!res.body) return reject(new Error('Could not reach instance metadata endpoint'));

      data.instanceType = res.body ;

      request(base + 'placement//availability-zone', function(err, res) {
        if (err) return reject(err);
        if (!res.body) return reject(new Error('Could not reach instance metadata endpoint'));

        data.availabilityZone = res.body;

        resolve(data);
      });
    });
  });
};
