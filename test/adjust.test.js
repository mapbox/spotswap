process.env.OnDemandGroup = 'MyDogOnDemand';
process.env.OnDemandScaleDownPolicy = 'MyScalingPolicy';
process.env.INSTANCE_ID = 'i-123';
process.env.EC2_REGION = 'us-test-1';
process.env.AWS_REGION = 'us-test-1';
process.env.AlarmSNSTopic = 'test';
process.env.STACK_NAME = 'test';

var AWS = require('@mapbox/mock-aws-sdk-js');
var test = require('tape');
var adjust = require('../lib/adjust');

var setDesiredCapacity, describeAutoScalingGroups, deleteTags, describeStacks;
function adjustUpMocks() {
  describeAutoScalingGroups = AWS.stub('AutoScaling', 'describeAutoScalingGroups', function(params) {
    var res;
    if (params.AutoScalingGroupNames == 'MyDogSpot') {
      res = {
        AutoScalingGroups: [{
          AutoScalingGroupName: 'api-ice-cream-spot',
          Instances: [
            { InstanceId: 'i-123' },
            { InstanceId: 'i-456' }
          ]
        }]
      };
    } else if (params.AutoScalingGroupNames == 'MyDogOnDemand') {
      res = {
        AutoScalingGroups: [{
          AutoScalingGroupName: 'api-ice-cream',
          Instances: [{ InstanceId: 'i-789' }],
          MinSize: 1,
          MaxSize: 11,
          DesiredCapacity: 1
        }]
      };
    }
    this.request.promise.returns(Promise.resolve(res));
  });

  setDesiredCapacity = AWS.stub('AutoScaling', 'setDesiredCapacity', function() {
    // assert.deepEqual(params, { AutoScalingGroupName: 'MyDogOnDemand', DesiredCapacity: 2 });
    this.request.promise.returns(Promise.resolve());
  });

  deleteTags = AWS.stub('EC2', 'deleteTags', function() {
    // assert.deepEqual(params, { Resources: ['i-123'], Tags: [{ Key: 'SpotTermination' }] });
    this.request.promise.returns(Promise.resolve());
  });

  describeStacks = AWS.stub('CloudFormation', 'describeStacks', function(params) {
    var res = {
      Stacks: []
    };
    if (params.StackName == 'test') {
      res.Stacks.push({ StackStatus: 'UPDATE_COMPLETE' });
    } else if (params.StackName == 'updating') {
      res.Stacks.push({ StackStatus: 'UPDATE_IN_PROGRESS' });
    }
    this.request.promise.returns(Promise.resolve(res));
  });
}

function adjustUpUnmock() {
  AWS.AutoScaling.restore();
  AWS.EC2.restore();
  AWS.CloudFormation.restore();
}

test('[adjust.up]', function(assert) {
  adjustUpMocks();
  adjust.up([{ id: 'i-123' }])
    .then(() => {
      assert.equal(describeStacks.callCount, 1, 'checked for updating status');
      assert.ok(describeStacks.calledWith({ StackName: process.env.STACK_NAME }), 'checked cfn properly');

      assert.equal(describeAutoScalingGroups.callCount, 1, 'checked existing ASG capacity');
      assert.ok(describeAutoScalingGroups.calledWith({
        AutoScalingGroupNames: [process.env.OnDemandGroup]
      }), 'checked corred ASG');

      assert.equal(setDesiredCapacity.callCount, 1, 'set new desired capacity');
      assert.ok(setDesiredCapacity.calledWith({
        AutoScalingGroupName: 'MyDogOnDemand',
        DesiredCapacity: 2
      }), 'set capacity properly');

      assert.equal(deleteTags.callCount, 1, 'deleted old tags');
      assert.ok(deleteTags.calledWith({
        Resources: ['i-123'],
        Tags: [{ Key: 'SpotTermination' }]
      }), 'deleted the right tags');
    })
    .catch(err => assert.ifError(err))
    .then(() => {
      adjustUpUnmock();
      assert.end();
    });
});

test('[adjust.up] - capped at maxSize', function(assert) {
  process.env.SpotInstanceTypes = 'm3.medium m3.large m3.xlarge m3.2xlarge';
  process.env.SpotInstanceWeights = '1 2 4 8';
  process.env.OnDemandWeight = '1';
  process.env.STACK_NAME = 'test';
  adjustUpMocks();

  adjust.up([
    { id: 'i-123', type: 'm3.2xlarge' },
    { id: 'i-456', type: 'm3.2xlarge' },
    { id: 'i-789', type: 'm3.large' }
  ])
    .then(() => {
      assert.equal(describeStacks.callCount, 1, 'checked for updating status');
      assert.ok(describeStacks.calledWith({ StackName: process.env.STACK_NAME }), 'checked cfn properly');

      assert.equal(describeAutoScalingGroups.callCount, 1, 'checked existing ASG capacity');
      assert.ok(describeAutoScalingGroups.calledWith({
        AutoScalingGroupNames: [process.env.OnDemandGroup]
      }), 'checked corred ASG');

      assert.equal(setDesiredCapacity.callCount, 1, 'set new desired capacity');
      assert.ok(setDesiredCapacity.calledWith({
        AutoScalingGroupName: 'MyDogOnDemand',
        DesiredCapacity: 11
      }), 'set capacity properly, capped at MaxSize');

      assert.equal(deleteTags.callCount, 1, 'deleted old tags');
      assert.ok(deleteTags.calledWith({
        Resources: ['i-123', 'i-456', 'i-789'],
        Tags: [{ Key: 'SpotTermination' }]
      }), 'deleted the right tags');
    })
    .catch(err => assert.ifError(err))
    .then(() => {
      adjustUpUnmock();
      delete process.env.SpotWeights;
      delete process.env.OnDemandWeight;
      assert.end();
    });
});

test('[adjust.up] - no-op, no increment', function(assert) {
  adjustUpMocks();
  adjust.up([])
    .then(() => {
      assert.equal(describeStacks.callCount, 1, 'checked for updating status');
      assert.ok(describeStacks.calledWith({ StackName: process.env.STACK_NAME }), 'checked cfn properly');

      assert.equal(describeAutoScalingGroups.callCount, 1, 'checked existing ASG capacity');
      assert.ok(describeAutoScalingGroups.calledWith({
        AutoScalingGroupNames: [process.env.OnDemandGroup]
      }), 'checked corred ASG');

      assert.equal(setDesiredCapacity.callCount, 1, 'set new desired capacity');
      assert.ok(setDesiredCapacity.calledWith({
        AutoScalingGroupName: 'MyDogOnDemand',
        DesiredCapacity: 1
      }), 'set capacity properly');

      assert.equal(deleteTags.callCount, 0, 'no tags to delete');
    })
    .catch(err => assert.ifError(err))
    .then(() => {
      adjustUpUnmock();
      assert.end();
    });
});

test('[adjust.up] - no-op, updating stack', function(assert) {
  process.env.STACK_NAME = 'updating';
  adjustUpMocks();
  adjust.up([{ id: 'i-123' }])
    .then(() => {
      assert.equal(describeStacks.callCount, 1, 'checked for updating status');
      assert.ok(describeStacks.calledWith({ StackName: process.env.STACK_NAME }), 'checked cfn properly');

      assert.equal(describeAutoScalingGroups.callCount, 0, 'did not check existing ASG capacity');

      assert.equal(setDesiredCapacity.callCount, 0, 'did not set new desired capacity');

      assert.equal(deleteTags.callCount, 0, 'no tags to delete');
    })
    .catch(err => assert.ifError(err))
    .then(() => {
      adjustUpUnmock();
      assert.end();
    });
});

test('[adjust.up] - err, stack not found', function(assert) {
  process.env.STACK_NAME = 'none';
  adjustUpMocks();
  adjust.up([{ id: 'i-123' }])
    .then(() => {
      assert.equal(describeStacks.callCount, 1, 'checked for updating status');
      assert.ok(describeStacks.calledWith({ StackName: process.env.STACK_NAME }), 'checked cfn properly');

      assert.equal(describeAutoScalingGroups.callCount, 0, 'did not check existing ASG capacity');

      assert.equal(setDesiredCapacity.callCount, 0, 'did not set new desired capacity');

      assert.equal(deleteTags.callCount, 0, 'no tags to delete');
    })
    .catch(err => {
      assert.ok(err);
      assert.equal(err.message, 'Stack not found: none');
    })
    .then(() => {
      adjustUpUnmock();
      assert.end();
    });
});

test('[adjust.up] - with instance weighting', function(assert) {
  process.env.SpotInstanceTypes = 'm3.medium m3.large m3.xlarge m3.2xlarge';
  process.env.SpotInstanceWeights = '1 2 4 8';
  process.env.OnDemandWeight = '1';
  process.env.STACK_NAME = 'test';
  adjustUpMocks();

  adjust.up([{ id: 'i-123', type: 'm3.2xlarge' }, { id: 'i-456', type: 'm3.large' }])
    .then(() => {
      assert.equal(describeStacks.callCount, 1, 'checked for updating status');
      assert.ok(describeStacks.calledWith({ StackName: process.env.STACK_NAME }), 'checked cfn properly');

      assert.equal(describeAutoScalingGroups.callCount, 1, 'checked existing ASG capacity');
      assert.ok(describeAutoScalingGroups.calledWith({
        AutoScalingGroupNames: [process.env.OnDemandGroup]
      }), 'checked corred ASG');

      assert.equal(setDesiredCapacity.callCount, 1, 'set new desired capacity');
      assert.ok(setDesiredCapacity.calledWith({
        AutoScalingGroupName: 'MyDogOnDemand',
        DesiredCapacity: 11
      }), 'set capacity properly');

      assert.equal(deleteTags.callCount, 1, 'deleted old tags');
      assert.ok(deleteTags.calledWith({
        Resources: ['i-123', 'i-456'],
        Tags: [{ Key: 'SpotTermination' }]
      }), 'deleted the right tags');
    })
    .catch(err => assert.ifError(err))
    .then(() => {
      adjustUpUnmock();
      delete process.env.SpotWeights;
      delete process.env.OnDemandWeight;
      assert.end();
    });
});

test('[adjust.up] spot fleet with sufficient number of pools', function(assert) {
  process.env.SpotFleet = 'my-spot-fleet';
  adjustUpMocks();
  var getMetrics = AWS.stub('CloudWatch', 'getMetricStatistics', function() {
    var data = { Datapoints: new Array(10) };
    data.Datapoints.fill({ Minimum: '3.0' });
    this.request.promise.returns(Promise.resolve(data));
  });

  adjust.up([{ id: 'i-123' }])
    .then(() => {
      assert.equal(describeStacks.callCount, 1, 'checked for updating status');
      assert.ok(describeStacks.calledWith({ StackName: process.env.STACK_NAME }), 'checked cfn properly');

      assert.equal(getMetrics.callCount, 1, 'checked spot fleet metrics');
      var metrics = getMetrics.args[0][0];
      assert.equal(+new Date(metrics.EndTime) - +new Date(metrics.StartTime), 10 * 60 * 1000, 'polled 10 minutes worth of metrics');
      delete metrics.StartTime;
      delete metrics.EndTime;
      assert.deepEqual(metrics, {
        Namespace: 'AWS/EC2Spot',
        MetricName: 'EligibleInstancePoolCount',
        Dimensions: [
          { Name: 'FleetRequestId', Value: process.env.SpotFleet }
        ],
        Statistics: ['Minimum'],
        Period: 60
      }, 'requested expected metrics');

      assert.equal(describeAutoScalingGroups.callCount, 0, 'did not check existing ASG capacity');
      assert.equal(setDesiredCapacity.callCount, 0, 'did not set new desired capacity');
      assert.equal(deleteTags.callCount, 0, 'no tags to delete');
    })
    .catch(err => assert.ifError(err))
    .then(() => {
      adjustUpUnmock();
      AWS.CloudWatch.restore();
      delete process.env.SpotFleet;
      assert.end();
    });
});

test('[adjust.up] spot fleet with insufficient number of pools', function(assert) {
  process.env.SpotFleet = 'my-spot-fleet';
  adjustUpMocks();
  var getMetrics = AWS.stub('CloudWatch', 'getMetricStatistics', function() {
    var data = {
      Datapoints: [
        { Minimum: '3.0' },
        { Minimum: '2.0' },
        { Minimum: '3.0' },
        { Minimum: '3.0' },
        { Minimum: '3.0' },
        { Minimum: '3.0' },
        { Minimum: '3.0' },
        { Minimum: '3.0' },
        { Minimum: '3.0' },
        { Minimum: '3.0' }
      ]
    };
    this.request.promise.returns(Promise.resolve(data));
  });

  adjust.up([{ id: 'i-123' }])
    .then(() => {
      assert.equal(describeStacks.callCount, 1, 'checked for updating status');
      assert.ok(describeStacks.calledWith({ StackName: process.env.STACK_NAME }), 'checked cfn properly');

      assert.equal(getMetrics.callCount, 1, 'checked spot fleet metrics');
      var metrics = getMetrics.args[0][0];
      assert.equal(+new Date(metrics.EndTime) - +new Date(metrics.StartTime), 10 * 60 * 1000, 'polled 10 minutes worth of metrics');
      delete metrics.StartTime;
      delete metrics.EndTime;
      assert.deepEqual(metrics, {
        Namespace: 'AWS/EC2Spot',
        MetricName: 'EligibleInstancePoolCount',
        Dimensions: [
          { Name: 'FleetRequestId', Value: process.env.SpotFleet }
        ],
        Statistics: ['Minimum'],
        Period: 60
      }, 'requested expected metrics');

      assert.equal(describeAutoScalingGroups.callCount, 1, 'checked existing ASG capacity');
      assert.ok(describeAutoScalingGroups.calledWith({
        AutoScalingGroupNames: [process.env.OnDemandGroup]
      }), 'checked corred ASG');

      assert.equal(setDesiredCapacity.callCount, 1, 'set new desired capacity');
      assert.ok(setDesiredCapacity.calledWith({
        AutoScalingGroupName: 'MyDogOnDemand',
        DesiredCapacity: 2
      }), 'set capacity properly');

      assert.equal(deleteTags.callCount, 1, 'deleted old tags');
      assert.ok(deleteTags.calledWith({
        Resources: ['i-123'],
        Tags: [{ Key: 'SpotTermination' }]
      }), 'deleted the right tags');
    })
    .catch(err => assert.ifError(err))
    .then(() => {
      adjustUpUnmock();
      AWS.CloudWatch.restore();
      delete process.env.SpotFleet;
      assert.end();
    });
});

function adjustDownMock() {
  describeAutoScalingGroups = AWS.stub('AutoScaling', 'describeAutoScalingGroups', function(params) {
    var res = {
      AutoScalingGroups: [
        {
          Instances: [
            { InstanceId: 'i-asg-1' },
            { InstanceId: 'i-asg-2' }
          ]
        }
      ]
    };
    res.AutoScalingGroups[0].DesiredCapacity = (params.AutoScalingGroupNames[0] === 'should-be-fulfilled') ? 2 : 3;
    this.request.promise.returns(Promise.resolve(res));
  });

  AWS.stub('EC2', 'describeSpotFleetRequests', function(params) {
    var res = {
      SpotFleetRequestConfigs: [{}]
    };
    res.SpotFleetRequestConfigs[0].ActivityStatus = (params.SpotFleetRequestIds[0] == 'should-be-fulfilled') ? 'fulfilled' : 'pending_fulfillment';
    this.request.promise.returns(Promise.resolve(res));
  });
}

function adjustDownUnmock() {
  AWS.AutoScaling.restore();
  AWS.EC2.restore();
}

test('[adjust.down] assessAsgState - should scale down', function(assert) {
  process.env.SpotGroup = 'should-be-fulfilled';
  adjustDownMock();
  adjust.assessAsgState('us-east-1', process.env.SpotGroup)
    .catch(err => assert.ifError(err))
    .then((data) => assert.deepEqual(data, { scale: true }))
    .then(() => {
      delete process.env.SpotGroup;
      adjustDownUnmock();
      assert.end();
    });
});

test('[adjust.down] assessAsgState - should not scale down', function(assert) {
  process.env.SpotGroup = 'should-not-be-fulfilled';
  adjustDownMock();
  adjust.assessAsgState('us-east-1', process.env.SpotGroup)
    .catch(err => assert.ifError(err))
    .then((data) => assert.deepEqual(data, { scale: false }))
    .then(() => {
      delete process.env.SpotGroup;
      adjustDownUnmock();
      assert.end();
    });
});

test('[adjust.down] assessSpotFleetState - should scale down', function(assert) {
  process.env.SpotFleet = 'should-be-fulfilled';
  adjustDownMock();
  adjust.assessSpotFleetState('us-east-1', process.env.SpotFleet)
    .catch(err => assert.ifError(err))
    .then((data) => assert.deepEqual(data, { scale: true }))
    .then(() => {
      delete process.env.SpotFleet;
      adjustDownUnmock();
      assert.end();
    });
});

test('[adjust.down] assessSpotFleetState - should not scale down (rate limiting)', function(assert) {
  process.env.SpotFleet = 'should-be-fulfilled';

  AWS.stub('EC2', 'describeSpotFleetRequests', function() {
    var err = new Error('Request limit exceeded.');
    err.code = 'RequestLimitExceeded';
    this.request.promise.returns(Promise.reject(err));
  });

  adjust.assessSpotFleetState('us-east-1', process.env.SpotFleet)
    .catch(err => assert.ifError(err, 'request errored'))
    .then((data) => assert.deepEqual(data, { scale: false }, 'refused to scale down when rate-limited'))
    .then(() => {
      delete process.env.SpotFleet;
      AWS.EC2.restore();
      assert.end();
    });
});

test('[adjust.down] assessSpotFleetState - should not scale down', function(assert) {
  process.env.SpotFleet = 'should-not-be-fulfilled';
  adjustDownMock();
  adjust.assessSpotFleetState('us-east-1', process.env.SpotFleet)
    .catch(err => assert.ifError(err))
    .then((data) => assert.deepEqual(data, { scale: false }))
    .then(() => {
      delete process.env.SpotFleet;
      adjustDownUnmock();
      assert.end();
    });
});

test('[adjust.down] the whole thing - asg [scales down]', function(assert) {
  adjustDownMock();

  process.env.SpotGroup = 'should-be-fulfilled';
  var executePolicy = AWS.stub('AutoScaling', 'executePolicy', function() {
    this.request.promise.returns(Promise.resolve());
  });
  adjust.down()
    .catch(err => assert.ifError(err))
    .then(() => {
      assert.ok(executePolicy.calledWith({
        AutoScalingGroupName: 'MyDogOnDemand',
        PolicyName: 'MyScalingPolicy',
        HonorCooldown: true
      }));
      assert.equal(executePolicy.callCount, 1);
    })
    .then(() => {
      delete process.env.SpotFleet;
      adjustDownUnmock();
      assert.end();
    });
});

test('[adjust.down] the whole thing - asg [does not scale down]', function(assert) {
  adjustDownMock();

  process.env.SpotGroup = 'should-not-be-fulfilled';
  var executePolicy = AWS.stub('AutoScaling', 'executePolicy', function() {
    this.request.promise.returns(Promise.resolve());
  });
  adjust.down()
    .catch(err => assert.ifError(err))
    .then(() => assert.equal(executePolicy.callCount, 0))
    .then(() => {
      delete process.env.SpotFleet;
      adjustDownUnmock();
      assert.end();
    });
});

test('[adjust.down] the whole thing - fleet [scales down]', function(assert) {
  adjustDownMock();
  var group = process.env.SpotGroup;
  delete process.env.SpotGroup;
  process.env.SpotFleet = 'should-be-fulfilled';
  var executePolicy = AWS.stub('AutoScaling', 'executePolicy', function() {
    this.request.promise.returns(Promise.resolve());
  });
  adjust.down()
    .catch(err => assert.ifError(err))
    .then(() => {
      assert.ok(executePolicy.calledWith({
        AutoScalingGroupName: 'MyDogOnDemand',
        PolicyName: 'MyScalingPolicy',
        HonorCooldown: true
      }));
      assert.equal(executePolicy.callCount, 1);
    })
    .then(() => {
      delete process.env.SpotFleet;
      process.env.SpotGroup = group;
      adjustDownUnmock();
      assert.end();
    });
});

test('[adjust.down] the whole thing - fleet [does not scale down]', function(assert) {
  adjustDownMock();
  process.env.SpotFleet = 'should-not-be-fulfilled';
  var executePolicy = AWS.stub('AutoScaling', 'executePolicy', function() {
    this.request.promise.returns(Promise.resolve());
  });
  adjust.down()
    .catch(err => assert.ifError(err))
    .then(() => assert.equal(executePolicy.callCount, 0))
    .then(() => {
      delete process.env.SpotFleet;
      adjustDownUnmock();
      assert.end();
    });
});

test('[adjust.down] the whole thing - fleet [respects cooldown]', function(assert) {
  adjustDownMock();
  process.env.SpotGroup = 'should-be-fulfilled';
  var executePolicy = AWS.stub('AutoScaling', 'executePolicy', function() {
    var err = new Error('Scaling activity is in progress and blocks the execution of this policy');
    err.code = 'ScalingActivityInProgress';
    this.request.promise.returns(Promise.reject(err));
  });
  adjust.down()
    .catch(err => assert.ifError(err))
    .then(() => assert.equal(executePolicy.callCount, 1))
    .then(() => {
      delete process.env.SpotFleet;
      adjustDownUnmock();
      assert.end();
    });
});

test('[adjust.down] the whole thing - fleet [step scaling policy]', function(assert) {
  adjustDownMock();
  process.env.SpotGroup = 'should-be-fulfilled';
  var executePolicy = AWS.stub('AutoScaling', 'executePolicy', function() {
    var err = new Error('Metric value must be specified for policy type StepScaling');
    err.code = 'ValidationError';
    this.request.promise.returns(Promise.reject(err));
  });
  adjust.down()
    .catch(err => assert.equal(
      err.message,
      'You must use a SimpleScaling policy with Spotswap: Metric value must be specified for policy type StepScaling',
      'amended error message if step scaling policy is used'
    ))
    .then(() => assert.equal(executePolicy.callCount, 1))
    .then(() => {
      adjustDownUnmock();
      assert.end();
    });
});
