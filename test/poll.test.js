process.env.OnDemandGroup = 'MyDogOnDemand';
process.env.SpotGroup = 'MyDogSpot';
process.env.INSTANCE_ID = 'i-123';
process.env.EC2_REGION = 'us-test-1';
process.env.AlarmSNSTopic = 'test';
process.env.STACK_NAME = 'test';
process.env.TerminationQueue = 'test';

var AWS = require('@mapbox/mock-aws-sdk-js');
var test = require('tape');
var sinon = require('sinon');
var poll = require('../lib/poll');
var fs = require('fs');
var os = require('os');
var path = require('path');

var semaphore = path.join(os.tmpdir(), 'give-up');

var server;
test('[poll] setup spot server', function(t) {
  var app = require('express')();
  app.get('/404', function(req, res) {
    res.status(404).send();
  });
  app.get('/200', function(req, res) {
    res.status(200).send('2017-02-24T00:54:10Z');
  });
  app.get('/mystery', function(req, res) {
    res.status(200).send('wut');
  });

  sinon.stub(poll, 'metadata').returns(Promise.resolve({
    instanceId: 'i-123',
    availabilityZone: '1a',
    instanceType: 'r3.8xlarge'
  }));

  t.test('[poll] start server', function(assert) {
    server = app.listen(5907, function() {
      assert.end();
    });
  });
});

test('[poll] terminating instance', function(assert) {
  process.env.INSTANCE_ID = 'i-123';
  var tag = AWS.stub('EC2', 'createTags', function() {
    this.request.promise.returns(Promise.resolve());
  });
  var terminate = AWS.stub('AutoScaling', 'terminateInstanceInAutoScalingGroup').yields();
  poll('http://localhost:5907/200', function(err, res) {
    assert.ifError(err);
    assert.notOk(res);
    assert.equal(tag.callCount, 1, 'tagged instance');
    assert.ok(tag.calledWith({
      Resources: ['i-123'],
      Tags: [{ Key: 'SpotTermination', Value: 'true' }]
    }));
    assert.equal(terminate.callCount, 1, 'terminated instance');
    assert.ok(terminate.calledWith({
      InstanceId: 'i-123',
      ShouldDecrementDesiredCapacity: false
    }));
    AWS.EC2.restore();
    AWS.AutoScaling.restore();
    fs.unlinkSync(semaphore);
    assert.end();
  });
});

test('[poll] handle error', function(assert) {
  process.env.INSTANCE_ID = 'i-123';
  var tag = AWS.stub('EC2', 'createTags', function() {
    this.request.promise.returns(Promise.reject(new Error('Nope')));
  });
  var terminate = AWS.stub('AutoScaling', 'terminateInstanceInAutoScalingGroup').yields();
  poll('http://localhost:5907/200', function(err) {
    assert.ok(err);
    assert.equal(err.message, 'Nope');
    assert.equal(tag.callCount, 1, 'tried to tag instance');
    assert.ok(tag.calledWith({
      Resources: ['i-123'],
      Tags: [{ Key: 'SpotTermination', Value: 'true' }]
    }));
    assert.equal(terminate.callCount, 0, 'not terminated');
    assert.throws(() => fs.statSync(semaphore), /ENOENT/, 'did not write file indicating tagging is complete');
    AWS.EC2.restore();
    AWS.AutoScaling.restore();
    assert.end();
  });
});

test('[poll] no-op', function(assert) {
  var tag = AWS.stub('EC2', 'createTags', function() {
    this.request.promise.returns(Promise.resolve());
  });
  var terminate = AWS.stub('AutoScaling', 'terminateInstanceInAutoScalingGroup').yields();
  poll('http://localhost:5907/404', function(err, res) {
    assert.ifError(err);
    assert.notOk(res);
    assert.equal(tag.callCount, 0, 'tagged instance');
    assert.equal(terminate.callCount, 0, 'did not terminate instances');
    assert.throws(() => fs.statSync(semaphore), /ENOENT/, 'did not write file indicating tagging is complete');
    AWS.EC2.restore();
    AWS.AutoScaling.restore();
    assert.end();
  });
});

test('[poll] no-op on a 200 with goop inside', function(assert) {
  var tag = AWS.stub('EC2', 'createTags', function() {
    this.request.promise.returns(Promise.resolve());
  });
  var terminate = AWS.stub('AutoScaling', 'terminateInstanceInAutoScalingGroup').yields();
  poll('http://localhost:5907/mystery', function(err, res) {
    assert.ifError(err);
    assert.notOk(res);
    assert.equal(tag.callCount, 0, 'tagged instance');
    assert.equal(terminate.callCount, 0, 'did not terminate instances');
    assert.throws(() => fs.statSync(semaphore), /ENOENT/, 'did not write file indicating tagging is complete');
    AWS.EC2.restore();
    AWS.AutoScaling.restore();
    assert.end();
  });
});

test('[poll] w/lambda override', function(assert) {
  var tag = AWS.stub('EC2', 'createTags', function() {
    this.request.promise.returns(Promise.resolve());
  });
  var terminate = AWS.stub('AutoScaling', 'terminateInstanceInAutoScalingGroup').yields();
  var invoke = AWS.stub('Lambda', 'invoke').yields();
  var lambdaArn = 'arn:aws:lambda:us-east-1:123456789012:function:dereg';

  process.env.INSTANCE_ID = 'i-123';
  poll('http://localhost:5907/200', lambdaArn, function(err) {
    assert.ifError(err, 'success');

    assert.equal(tag.callCount, 1, 'tagged instances');
    assert.equal(terminate.callCount, 0, 'did not terminate instances');
    assert.equal(AWS.Lambda.callCount, 1, 'made lambda client');
    assert.ok(AWS.Lambda.calledWith({ region: 'us-east-1' }), 'made lambda client in expected region');
    assert.equal(invoke.callCount, 1, 'invoked lambda function');
    assert.ok(invoke.calledWith({
      FunctionName: lambdaArn,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        instanceId: process.env.INSTANCE_ID,
        availabilityZone: '1a',
        instanceType: 'r3.8xlarge',
        caller: 'spotswap-poll',
        noTermination: true
      })
    }), 'invoked Lambda function with expected args');
    assert.ok(fs.statSync(semaphore), 'wrote file indicating tagging is complete');
    fs.unlinkSync(semaphore);
    AWS.EC2.restore();
    AWS.AutoScaling.restore();
    AWS.Lambda.restore();
    assert.end();
  });
});

test('[poll] termination from a spot fleet', function(assert) {
  var tag = AWS.stub('EC2', 'createTags', function() {
    this.request.promise.returns(Promise.resolve());
  });
  var terminate = AWS.stub('EC2', 'terminateInstances').yields();
  process.env.SpotFleet = process.env.SpotGroup;
  delete process.env.SpotGroup;

  process.env.INSTANCE_ID = 'i-123';
  poll('http://localhost:5907/200', null, function(err) {
    assert.ifError(err, 'success');
    assert.equal(tag.callCount, 1, 'tagged instances');
    assert.equal(terminate.callCount, 1, 'terminated instance');
    assert.ok(fs.statSync(semaphore), 'wrote file indicating tagging is complete');
    fs.unlinkSync(semaphore);
    AWS.EC2.restore();
    process.env.SpotGroup = process.env.SpotFleet;
    delete process.env.SpotFleet;
    assert.end();
  });
});

test('[poll] cleanup', function(assert) {
  server.close();
  poll.metadata.restore();
  assert.end();
});
