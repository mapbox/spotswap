/* eslint-disable no-console */

var AWS = require('aws-sdk');

module.exports = {
  up: up,
  down: down,
  updating: updating,
  assessSpotFleetState: assessSpotFleetState,
  assessAsgState: assessAsgState
};

function traceable(err, noPromise) {
  Error.captureStackTrace(err, arguments.callee);
  return noPromise ? err : Promise.reject(err);
}

/**
 * Read current state of AutoScaling Group
 * and increment the DesiredCapacity appropriately. Then
 * remove tags from the spot instances tagged for
 * termination.
 *
 * No-op if the number to increment by is less than 1.
 * No-op if the target stack is in the process of updating.
 *
 * @param {array} instances that must be accounted for. The
 * function will scale the on-demand group by the length of
 * this array.
 * @returns {promise} resolves when all the work is done.
 */
function up(instances) {
  var autoscaling = new AWS.AutoScaling();
  var ec2 = new AWS.EC2();
  var instanceIds = instances.map(instance => instance.id);
  var tagsToDelete = { Resources: instanceIds, Tags: [{ Key: 'SpotTermination' }] };

  // Determine instance weighting
  var spotWeights, onDemandWeight;
  if (process.env.SpotInstanceTypes) {
    var types = process.env.SpotInstanceTypes.split(' ');
    var weights = process.env.SpotInstanceWeights.split(' ').map(weight => Number(weight));
    spotWeights = types.reduce((spotWeights, type, i) => {
      spotWeights[type] = weights[i];
      return spotWeights;
    }, {});

    onDemandWeight = Number(process.env.OnDemandWeight);
    console.log('Instance type weighting: %j', spotWeights);
  }

  // Should we scale up? checks
  var shouldScale = [updating(process.env.STACK_NAME)];
  if (process.env.SpotFleet) shouldScale.push(sufficientFleetPools(process.env.SpotFleet));

  return Promise.all(shouldScale)
    .then(results => {
      var whyNot = [];
      if (results[0]) whyNot.push('IsUpdating');
      if (results[1]) whyNot.push('SufficientFleetPools');

      return whyNot.length ? Promise.reject({ noop: whyNot }) : Promise.resolve();
    })
    .then(() => {
      var params = { AutoScalingGroupNames: [process.env.OnDemandGroup] };
      return autoscaling.describeAutoScalingGroups(params).promise().catch(err => traceable(err));
    })
    .then(data => {
      if (!data.AutoScalingGroups || !data.AutoScalingGroups[0])
        throw new Error('Unable to describe AutoScaling Group');

      var currentDesired = data.AutoScalingGroups[0].DesiredCapacity;
      var newDesired = currentDesired + instances.length;
      var maxSize = data.AutoScalingGroups[0].MaxSize;

      if (spotWeights && onDemandWeight) {
        var lostCapacity = instances.reduce((lostCapacity, instance) => {
          return lostCapacity + spotWeights[instance.type];
        }, 0);

        var newInstances = Math.ceil(lostCapacity / onDemandWeight);
        newDesired = currentDesired + newInstances;
      }

      var params = {
        AutoScalingGroupName: process.env.OnDemandGroup,
        DesiredCapacity: Math.min(maxSize, newDesired)
      };

      var count = newInstances ? newInstances : instances.length;
      console.log(`Lost ${lostCapacity || instances.length} capacity. Replacing with ${count} new instances`);
      return autoscaling.setDesiredCapacity(params).promise().catch(err => traceable(err));
    })
    .then(() => instances.length ? ec2.deleteTags(tagsToDelete).promise().catch(err => traceable(err)) : null)
    .catch(err => {
      if (err.noop) {
        if (err.noop.indexOf('IsUpdating') !== -1) console.log('No-op on stack during a CloudFormation update');
        if (err.noop.indexOf('SufficientFleetPools') !== -1) console.log('No-op when fleet has >2 pools to draw on');
        return;
      }

      throw err;
    });
}

/**
 * Read current state of the stack to determine if
 * it's in the process of updating. This is to prevent
 * spotswap from making out-of-band requests to change
 * Desired Capacity, which breaks an in-progress
 * CloudFormation update.
 *
 * @param {Number} stackName - name of the target stack
 * @param {Function} callback
 */
function updating(stackName) {
  var cfn = new AWS.CloudFormation();
  var updateStatus = {
    CREATE_IN_PROGRESS: true,
    ROLLBACK_IN_PROGRESS: true,
    DELETE_IN_PROGRESS: true,
    UPDATE_IN_PROGRESS: true,
    UPDATE_COMPLETE_CLEANUP_IN_PROGRESS: true,
    UPDATE_ROLLBACK_IN_PROGRESS: true,
    UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS: true
  };

  return cfn.describeStacks({ StackName: stackName }).promise()
    .catch(err => traceable(err))
    .then(data => {
      if (!data.Stacks.length) throw new Error('Stack not found: ' + stackName);
      var status = data.Stacks[0].StackStatus;
      return !!updateStatus[status];
    });
}

/**
 * Checks whether a Spot Fleet has more than 2 pools in which it can place
 * instances.
 *
 * @param {string} fleetId - the spot fleet request id
 * @returns {promise} resolves to true/false indicating if there are more than
 * 2 pools where the fleet can land instance requests.
 */
function sufficientFleetPools(fleetId) {
  var cw = new AWS.CloudWatch();
  var now = Date.now();
  return cw.getMetricStatistics({
    Namespace: 'AWS/EC2Spot',
    MetricName: 'EligibleInstancePoolCount',
    Dimensions: [
      { Name: 'FleetRequestId', Value: fleetId }
    ],
    Statistics: ['Minimum'],
    StartTime: (new Date(now - 10 * 60 * 1000)).toISOString(),
    EndTime: new Date(now).toISOString(),
    Period: 60
  }).promise().catch(err => traceable(err))
    .then(data => {
      return data.Datapoints.reduce((sufficient, datapoint) => {
        if (!sufficient) return sufficient;
        return Number(datapoint.Minimum) > 2;
      }, true);
    });
}

/**
 * Read the current state of the spot fleet or group
 * and decide if we can scale down. If so,
 * invoke a scale down policy.
 *
 * No-op if the spot fleet/group is below its desired size.
 *
 * @returns {promise} resolves when all the work is done.
 */
function down() {
  var name = process.env.SpotGroup || process.env.SpotFleet;
  var assessFulfillment = process.env.SpotGroup ? assessAsgState : assessSpotFleetState;
  var region = process.env.AWS_REGION;
  var policy = process.env.OnDemandScaleDownPolicy;
  var group = process.env.OnDemandGroup;

  return assessFulfillment(region, name)
    .then(data => data.scale ? executeScalingPolicy(region, policy, group) : Promise.resolve());
}

/**
 * Assess state of Spot Fleet.
 *
 * @param {string} name - fleet request id
 * @returns {promise} returns `true` if scale
 * down is advisable. Returns `false` if not.
 */
function assessSpotFleetState(region, name) {
  var ec2 = new AWS.EC2({ region });

  console.log(`Checking spot fleet ${name} for scaledown`);
  return ec2.describeSpotFleetRequests({ SpotFleetRequestIds: [name] }).promise()
    .then(data => {
      if (!data.SpotFleetRequestConfigs || !data.SpotFleetRequestConfigs[0])
        throw new Error('Cannot describe fleet.');
      /**
       * The progress of the Spot fleet request. If there is an error, the status is error. After all bids are placed, the status
       * is pending_fulfillment. If the size of the fleet is equal to or greater than its target capacity, the status is fulfilled.
       * If the size of the fleet is decreased, the status is pending_termination while Spot instances are terminating.
       *
       * From: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/EC2.html#describeSpotFleetRequests-property
       */

      return data.SpotFleetRequestConfigs[0].ActivityStatus && data.SpotFleetRequestConfigs[0].ActivityStatus === 'fulfilled' ?
        { scale: true } : { scale: false };
    })
    .catch(err => {
      if (err.code === 'RequestLimitExceeded') return { scale: false };
      return traceable(err);
    });
}

/**
 * Assess state of spot autoscaling group.
 *
 * @param {string} name - autoscaling group name
 * @returns {promise} returns `true` if scale
 * down is advisable. Returns `false` if not.
 */
function assessAsgState(region, name) {
  var autoscaling = new AWS.AutoScaling({ region });

  console.log(`Checking spot group ${name} for scaledown`);
  return autoscaling.describeAutoScalingGroups({ AutoScalingGroupNames: [name] }).promise()
    .catch(err => traceable(err))
    .then(data => {
      if (!data.AutoScalingGroups || !data.AutoScalingGroups[0])
        throw new Error('Cannot describe group.');

      var group = data.AutoScalingGroups[0];
      /**
       * If the group has fewer instances than its desired capacity, don't scale down.
       */
      return group.Instances.length < group.DesiredCapacity ?
        { scale: false } : { scale: true };
    });
}



/**
 * Execute an AutoScaling Scaling Policy, respecting
 * the cooldown.
 */
function executeScalingPolicy(region, policy, asg) {
  var autoscaling = new AWS.AutoScaling({ region });
  var params = {
    PolicyName: policy,
    AutoScalingGroupName: asg,
    HonorCooldown: true
  };

  if (/^arn:/.test(policy)) delete params.AutoScalingGroupName;

  console.log(`Scaling down ${asg} by executing ${policy}`);
  return autoscaling.executePolicy(params)
    .promise()
    .catch(err => {
      err = traceable(err, true);

      if (err.code === 'ValidationError' && /StepScaling/.test(err.message)) {
        var newError = new Error(`You must use a SimpleScaling policy with Spotswap: ${err.message}`);
        return Promise.reject(newError);
      }

      if (err.code === 'ScalingActivityInProgress') {
        console.log('Scaledown prevented by cooldown period');
        return Promise.resolve();
      }

      console.log('Scaling policy execution leaked an error');
      console.log(err.stack);
      console.log(err.code);
      return Promise.reject(err);
    });
}
