var AWS = require('@mapbox/mock-aws-sdk-js');
var test = require('tape');
var scan = require('../lib/scan');

test('[scan] - asg', function(assert) {
  process.env.AWS_REGION = 'us-east-1';
  process.env.SpotGroup = 'spot-asg';

  var describeAsg = AWS.stub('AutoScaling', 'describeAutoScalingGroups', function() {
    this.request.promise.returns(Promise.resolve({
      AutoScalingGroups: [
        {
          Instances: [
            { InstanceId: 'i-asg-1' },
            { InstanceId: 'i-asg-2' }
          ]
        }
      ]
    }));
  });

  var describeFleet = AWS.stub('EC2', 'describeSpotFleetInstances').returns({
    eachPage: function(callback) {
      callback(null, { ActiveInstances: [{ InstanceId: 'i-fleet-1' }] }, function() {
        callback(null, { ActiveInstances: [{ InstanceId: 'i-fleet-2' }] }, function() {
          callback();
        });
      });
    }
  });

  var describeInstances = AWS.stub('EC2', 'describeInstances').returns({
    eachPage: function(callback) {
      callback(null, { Reservations: [{ Instances: [{ InstanceId: 'i-asg-1', InstanceType: 'm3.medium' }] }] }, function() {
        callback(null, { Reservations: [] }, function() {
          callback();
        });
      });
    }
  });

  scan()
    .then(data => {
      assert.deepEqual(data, [{ id: 'i-asg-1', type: 'm3.medium' }]);
      assert.equal(describeAsg.callCount, 1, 'described autoscaling group once');
      assert.ok(describeAsg.calledWith({ AutoScalingGroupNames: ['spot-asg'] }), 'described autoscaling group called with correct params');
      assert.equal(describeFleet.callCount, 0, 'did not try to describe spotfleet');
      assert.equal(describeInstances.callCount, 1, 'describe instances once');
      assert.ok(describeInstances.calledWith({
        Filters: [
          { Name: 'instance-state-name', Values: ['running'] },
          { Name: 'tag-key', Values: ['SpotTermination'] }
        ],
        InstanceIds: ['i-asg-1', 'i-asg-2']
      }), 'describe instances called with correct params');
    })
    .catch(err => assert.ifError(err))
    .then(() => {
      AWS.EC2.restore();
      AWS.AutoScaling.restore();
      delete process.env.SpotGroup;
      assert.end();
    });
});

test('[scan] - fleet', function(assert) {
  process.env.AWS_DEFAULT_REGION = 'us-east-1';
  process.env.SpotFleet = 'spot-fleet';

  var describeAsg = AWS.stub('AutoScaling', 'describeAutoScalingGroups', function() {
    this.request.promise.returns(Promise.resolve({
      AutoScalingGroups: [
        {
          Instances: [
            { InstanceId: 'i-asg-1' },
            { InstanceId: 'i-asg-2' }
          ]
        }
      ]
    }));
  });

  var describeFleet = AWS.stub('EC2', 'describeSpotFleetInstances').returns({
    eachPage: function(callback) {
      callback(null, { ActiveInstances: [{ InstanceId: 'i-fleet-1' }] }, function() {
        callback(null, { ActiveInstances: [{ InstanceId: 'i-fleet-2' }] }, function() {
          callback();
        });
      });
    }
  });

  var describeInstances = AWS.stub('EC2', 'describeInstances').returns({
    eachPage: function(callback) {
      callback(null, { Reservations: [{ Instances: [{ InstanceId: 'i-fleet-1', InstanceType: 'm3.large' }] }] }, function() {
        callback(null, { Reservations: [{ Instances: [{ InstanceId: 'i-fleet-2', InstanceType: 'm3.medium' }] }] }, function() {
          callback();
        });
      });
    }
  });

  scan()
    .then(data => {
      assert.deepEqual(data, [
        { id: 'i-fleet-1', type: 'm3.large' },
        { id: 'i-fleet-2', type: 'm3.medium' }
      ]);
      assert.equal(describeAsg.callCount, 0, 'did not try to describe autoscaling group');
      assert.equal(describeFleet.callCount, 1, 'described spotfleet once');
      assert.ok(describeFleet.calledWith({ SpotFleetRequestId: 'spot-fleet' }), 'described fleet called with correct params');
      assert.equal(describeInstances.callCount, 1, 'describe instances once');
      assert.ok(describeInstances.calledWith({
        Filters: [
          { Name: 'instance-state-name', Values: ['running'] },
          { Name: 'tag-key', Values: ['SpotTermination'] }
        ],
        InstanceIds: ['i-fleet-1', 'i-fleet-2']
      }), 'describe instances called with correct params');
    })
    .catch(err => assert.ifError(err))
    .then(() => {
      AWS.EC2.restore();
      AWS.AutoScaling.restore();
      delete process.env.SpotFleet;
      assert.end();
    });
});
