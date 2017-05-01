/* eslint-disable no-console */

var AWS = require('aws-sdk');

module.exports = numTerminated;

function traceable(err, noPromise) {
  Error.captureStackTrace(err, arguments.callee);
  return noPromise ? err : Promise.reject(err);
}

/**
 * Find all instances in spot AutoScaling Group
 * that have been marked for termination.
 *
 * @returns (null, num) where num is the number
 * of spot instances marked for termination.
 */
function numTerminated() {
  if (!process.env.SpotGroup && !process.env.SpotFleet)
    return Promise.reject(new Error('$SpotGroup or $SpotFleet must be specified'));
  if (process.env.SpotGroup && process.env.SpotFleet)
    return Promise.reject(new Error('Only one of $SpotGroup or $SpotFleet should be specified'));

  var name = process.env.SpotGroup || process.env.SpotFleet;
  var getInstances = process.env.SpotGroup ? getAsgInstances : getSpotFleetInstances;
  var region = process.env.AWS_REGION;

  return getInstances(region, name)
    .then(ids => getTags(region, ids))
    .then(tagged => {
      console.log(`Found ${tagged.length} instances with SpotTermination tag`);
      return tagged;
    });
}

/**
 * Get instance ids for an autoscaling group
 *
 * @param {string} asgName - autoscaling group name
 * @returns {promise} with instance ids
 */
function getAsgInstances(region, asgName) {
  var autoscaling = new AWS.AutoScaling({ region });
  console.log(`Finding instance ids in spot group: ${asgName}`);
  return autoscaling.describeAutoScalingGroups({ AutoScalingGroupNames: [asgName] }).promise()
    .catch(err => traceable(err))
    .then(data => data.AutoScalingGroups[0].Instances.map(instance => {
      return instance.InstanceId;
    }));
}

/**
 * Get instance ids for a spot fleet
 *
 * @param {string} region
 * @param {string} fleetId - spotfleet request id
 * @returns {promise} with instance ids
 */
function getSpotFleetInstances(region, fleetId) {
  var ec2 = new AWS.EC2({ region });
  return new Promise((resolve, reject) => {
    var instances = [];
    console.log(`Finding instance ids in spot fleet: ${fleetId}`);
    ec2.describeSpotFleetInstances({ SpotFleetRequestId: fleetId }).eachPage((err, data, done) => {
      if (err) return reject(traceable(err, true));
      if (!data) return resolve(instances);
      if (!data.ActiveInstances.length) return resolve(instances);
      instances = instances.concat(data.ActiveInstances.map(instance => {
        return instance.InstanceId;
      }));
      done();
    });
  });
}

/**
 * Respects a grace period of 5 minutes before deregistering and
 * shutting down instances.
 *
 * @param {string} region
 * @param {array} instances - instance ids to look for tags on
 * @returns {promise} resolves with number of tags found
 */
function getTags(region, instances) {
  var ec2 = new AWS.EC2({ region });
  return new Promise((resolve, reject) => {
    if (!instances.length) {
      console.log('No instances listed');
      return resolve([]);
    }

    var tagged = [];
    console.log(`Checking for termination tags on ${instances.length} instances`);
    ec2.describeInstances({
      Filters: [
        { Name: 'instance-state-name', Values: ['running'] },
        { Name: 'tag-key', Values: ['SpotTermination'] }
      ],
      InstanceIds: instances
    }).eachPage((err, data, done) => {
      if (err) return reject(traceable(err, true));
      if (!data || !data.Reservations.length) return resolve(tagged);

      data.Reservations.forEach(reservation => {
        reservation.Instances.forEach(instance => {
          tagged.push({
            id: instance.InstanceId,
            type: instance.InstanceType
          });
        });
      });

      done();
    });
  });
}
