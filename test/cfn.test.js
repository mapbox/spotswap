var test = require('tape');
var spotswap = require('..');
var cf = require('cloudfriend');

test('[cfn] required options', function(assert) {
  assert.throws(function() {
    spotswap.cfn.template();
  }, /You must provide configuration options/, 'throws without options');

  assert.throws(function() {
    spotswap.cfn.template({
      spotFleet: 'sfr-abcd',
      onDemandGroup: 'pricey-boxes',
      scaleDownPolicy: 'kill-them-all',
      alarmTopic: 'sort-it-out-later',
      SpotSwapFunctionBucket: 'code-bucket',
      SpotSwapFunctionS3Key: 'code-key'
    });
  }, /You must specify the application's name/, 'throws without options.name');

  assert.throws(function() {
    spotswap.cfn.template({
      name: 'my-application',
      onDemandGroup: 'pricey-boxes',
      scaleDownPolicy: 'kill-them-all',
      alarmTopic: 'sort-it-out-later',
      SpotSwapFunctionBucket: 'code-bucket',
      SpotSwapFunctionS3Key: 'code-key'
    });
  }, /You must specify the logical name of a spotFleet or a spotGroup/, 'throws without options.spotFleet or options.spotGroup');

  assert.throws(function() {
    spotswap.cfn.template({
      name: 'my-application',
      spotGroup: 'cheapos',
      scaleDownPolicy: 'kill-them-all',
      alarmTopic: 'sort-it-out-later',
      SpotSwapFunctionBucket: 'code-bucket',
      SpotSwapFunctionS3Key: 'code-key'
    });
  }, /You must specify the logical name of an on-demand auto scaling group/, 'throws without options.onDemandGroup');

  assert.throws(function() {
    spotswap.cfn.template({
      name: 'my-application',
      onDemandGroup: 'pricey-boxes',
      spotGroup: 'cheapos',
      alarmTopic: 'sort-it-out-later',
      SpotSwapFunctionBucket: 'code-bucket',
      SpotSwapFunctionS3Key: 'code-key'
    });
  }, /You must specify the logical name of a scaling policy to reduce the size of the on-demand auto scaling group/, 'throws without options.scaleDownPolicy');

  assert.throws(function() {
    spotswap.cfn.template({
      name: 'my-application',
      onDemandGroup: 'pricey-boxes',
      spotGroup: 'cheapos',
      scaleDownPolicy: 'kill-them-all',
      SpotSwapFunctionBucket: 'code-bucket',
      SpotSwapFunctionS3Key: 'code-key'
    });
  }, /You must specify the logical name of an SNS topic to receive error alarms/, 'throws without options.alarmTopic');

  assert.throws(function() {
    spotswap.cfn.template({
      name: 'my-application',
      onDemandGroup: 'pricey-boxes',
      spotGroup: 'cheapos',
      scaleDownPolicy: 'kill-them-all',
      alarmTopic: 'sort-it-out-later',
      spotInstanceTypes: 'm3.medium',
      SpotSwapFunctionBucket: 'code-bucket',
      SpotSwapFunctionS3Key: 'code-key'
    });
  }, /If any of spotInstanceTypes, spotInstanceWeights, onDemandWeight are specified, then they all must be specified/, 'throws with partial weighting info');

  assert.throws(function() {
    spotswap.cfn.template({
      name: 'my-application',
      onDemandGroup: 'pricey-boxes',
      spotGroup: 'cheapos',
      scaleDownPolicy: 'kill-them-all',
      alarmTopic: 'sort-it-out-later'
    });
  }, /You must specify the AWS S3 bucket containing the SpotSwapFunction code/,
  'throws without options.SpotSwapFunctionBucket');

  assert.throws(function() {
    spotswap.cfn.template({
      name: 'my-application',
      onDemandGroup: 'pricey-boxes',
      spotGroup: 'cheapos',
      scaleDownPolicy: 'kill-them-all',
      alarmTopic: 'sort-it-out-later',
      SpotSwapFunctionBucket: 'code-bucket'
    });
  }, /You must specify the AWS S3 key for the SpotSwapFunction code/, 'throws without options.SpotSwapFunctionS3Key');

  assert.end();
});

test('[cfn] all template objects present', function(assert) {
  var snippet = spotswap.cfn.template({
    name: 'my-application',
    onDemandGroup: 'pricey-boxes',
    spotGroup: 'cheapos',
    scaleDownPolicy: 'kill-them-all',
    alarmTopic: 'sort-it-out-later',
    SpotSwapFunctionBucket: 'code-bucket',
    SpotSwapFunctionS3Key: 'code-key'
  });

  assert.ok(snippet.Resources.SpotswapLambdaRole, 'contains SpotswapLambdaRole resource');
  assert.ok(snippet.Resources.SpotswapFunction, 'contains SpotswapFunction resource');
  assert.ok(snippet.Resources.SpotswapSchedule, 'contains SpotswapSchedule resource');
  assert.end();
});

test('[cfn] SpotswapFunction env vars', function(assert) {
  var config = spotswap.cfn.template({
    name: 'my-application',
    onDemandGroup: 'pricey-boxes',
    spotGroup: 'cheapos',
    scaleDownPolicy: 'kill-them-all',
    alarmTopic: 'sort-it-out-later',
    SpotSwapFunctionBucket: 'code-bucket',
    SpotSwapFunctionS3Key: 'code-key'
  }).Resources.SpotswapFunction.Properties.Environment.Variables;

  assert.deepEqual(config.OnDemandGroup, cf.ref('pricey-boxes'), 'sets OnDemandGroup env var');
  assert.deepEqual(config.OnDemandScaleDownPolicy, cf.ref('kill-them-all'), 'sets OnDemandScaleDownPolicy env var');
  assert.deepEqual(config.SpotGroup, cf.ref('cheapos'), 'sets SpotGroup env var');

  config = spotswap.cfn.template({
    name: 'my-application',
    onDemandGroup: 'pricey-boxes',
    spotFleet: 'cheapos',
    scaleDownPolicy: 'kill-them-all',
    alarmTopic: 'sort-it-out-later',
    SpotSwapFunctionBucket: 'code-bucket',
    SpotSwapFunctionS3Key: 'code-key'
  }).Resources.SpotswapFunction.Properties.Environment.Variables;

  assert.deepEqual(config.SpotFleet, cf.ref('cheapos'), 'sets SpotFleet env var');

  config = spotswap.cfn.template({
    name: 'my-application',
    onDemandGroup: 'pricey-boxes',
    spotFleet: 'cheapos',
    scaleDownPolicy: 'kill-them-all',
    alarmTopic: 'sort-it-out-later',
    spotInstanceTypes: 'SpotTypes',
    spotInstanceWeights: 'SpotWeights',
    onDemandWeight: 'OnDemando',
    SpotSwapFunctionBucket: 'code-bucket',
    SpotSwapFunctionS3Key: 'code-key'
  }).Resources.SpotswapFunction.Properties.Environment.Variables;

  assert.deepEqual(config.SpotInstanceTypes, cf.ref('SpotTypes'), 'sets SpotInstanceTypes env var');
  assert.deepEqual(config.SpotInstanceWeights, cf.join(' ', cf.ref('SpotWeights')), 'sets SpotInstanceWeights env var');
  assert.deepEqual(config.OnDemandWeight, cf.ref('OnDemando'), 'sets OnDemandWeight env var');

  config = spotswap.cfn.template({
    name: 'my-application',
    onDemandGroup: 'pricey-boxes',
    spotFleet: 'cheapos',
    scaleDownPolicy: 'kill-them-all',
    alarmTopic: 'sort-it-out-later',
    spotInstanceTypes: 'SpotTypeOne,SpotTypeTwo',
    spotInstanceWeights: 'SpotWeights',
    onDemandWeight: 'OnDemando',
    SpotSwapFunctionBucket: 'code-bucket',
    SpotSwapFunctionS3Key: 'code-key'
  }).Resources.SpotswapFunction.Properties.Environment.Variables;

  assert.deepEqual(config.SpotInstanceTypes, cf.join(' ', [cf.ref('SpotTypeOne'), cf.ref('SpotTypeTwo')]), 'sets SpotInstanceTypes env var');
  assert.deepEqual(config.SpotInstanceWeights, cf.join(' ', cf.ref('SpotWeights')), 'sets SpotInstanceWeights env var');
  assert.deepEqual(config.OnDemandWeight, cf.ref('OnDemando'), 'sets OnDemandWeight env var');

  assert.end();
});

test('[cfn] SpotswapFunction', function(assert) {
  var fn = spotswap.cfn.template({
    name: 'my-application',
    onDemandGroup: 'pricey-boxes',
    spotGroup: 'cheapos',
    scaleDownPolicy: 'kill-them-all',
    alarmTopic: 'sort-it-out-later',
    SpotSwapFunctionBucket: 'code-bucket',
    SpotSwapFunctionS3Key: 'code-key'
  }).Resources.SpotswapFunction;

  assert.equal(fn.Properties.Handler, 'node_modules/@mapbox/spotswap/index.spotswap', 'default handler');

  fn = spotswap.cfn.template({
    name: 'my-application',
    onDemandGroup: 'pricey-boxes',
    spotGroup: 'cheapos',
    scaleDownPolicy: 'kill-them-all',
    alarmTopic: 'sort-it-out-later',
    handler: 'index.spotswap',
    SpotSwapFunctionBucket: 'code-bucket',
    SpotSwapFunctionS3Key: 'code-key'
  }).Resources.SpotswapFunction;

  assert.equal(fn.Properties.Handler, 'index.spotswap', 'handler override');

  assert.end();
});

test('[cfn] SpotswapFunctionErrorAlarm', function(assert) {
  var alarmStr = spotswap.cfn.template({
    name: 'my-application',
    onDemandGroup: 'pricey-boxes',
    spotGroup: 'cheapos',
    scaleDownPolicy: 'kill-them-all',
    alarmTopic: 'sort-it-out-later',
    SpotSwapFunctionBucket: 'code-bucket',
    SpotSwapFunctionS3Key: 'code-key'
  }).Resources.SpotswapFunctionErrorAlarm;

  assert.deepEqual(alarmStr.Properties.AlarmActions, [cf.ref('sort-it-out-later')], 'sets alarm action');
  assert.deepEqual(alarmStr.Properties.InsufficientDataActions, [cf.ref('sort-it-out-later')], 'sets insufficient data action');

  var alarmRef = spotswap.cfn.template({
    name: 'my-application',
    onDemandGroup: 'pricey-boxes',
    spotGroup: 'cheapos',
    scaleDownPolicy: 'kill-them-all',
    alarmTopic: cf.ref('sort-it-out-later'),
    SpotSwapFunctionBucket: 'code-bucket',
    SpotSwapFunctionS3Key: 'code-key'
  }).Resources.SpotswapFunctionErrorAlarm;

  assert.deepEqual(alarmRef.Properties.AlarmActions, [cf.ref('sort-it-out-later')], 'sets alarm action when provided a ref');
  assert.deepEqual(alarmRef.Properties.InsufficientDataActions, [cf.ref('sort-it-out-later')], 'sets insufficient data action when provided a ref');

  var alarmJoin = spotswap.cfn.template({
    name: 'my-application',
    onDemandGroup: 'pricey-boxes',
    spotGroup: 'cheapos',
    scaleDownPolicy: 'kill-them-all',
    alarmTopic: cf.join(['sort', 'it', 'out', 'later']),
    SpotSwapFunctionBucket: 'code-bucket',
    SpotSwapFunctionS3Key: 'code-key'
  }).Resources.SpotswapFunctionErrorAlarm;

  assert.deepEqual(alarmJoin.Properties.AlarmActions, [cf.join(['sort', 'it', 'out', 'later'])], 'sets alarm action when provided a ref');
  assert.deepEqual(alarmJoin.Properties.InsufficientDataActions, [cf.join(['sort', 'it', 'out', 'later'])], 'sets insufficient data action when provided a ref');

  assert.end();
});
