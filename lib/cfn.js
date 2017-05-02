var cf = require('cloudfriend');

module.exports = { template, validate };

/**
 * Provides a CloudFormation template snippet including resources and mappings
 * that are required in order to run spotswap. The snippet assumes there is:
 * - GitSha: a parameter with the sha of the application being deployed
 * - Lambda bundle: a zipfile containing code exists at
 *   `s3://mapbox-${region}/slugs/${name}/${sha}.zip`
 *
 * @param {object} options - spotswap's configuration options
 * @param {string} options.name - the application's name
 * @param {string} [options.handler=node_modules/@mapbox/spotswap/index.spotswap] - the
 * path within the code bundle that provides spotswap's Lambda function code.
 * The default setting assumes that spotswap is a dependency to your application
 * that can be found in the `node_modules` folder.
 * @param {string} [options.spotFleet] - the logical name of a spot fleet
 * @param {string} [options.spotGroup] - the logical name of a spot auto
 * scaling group
 * @param {string} [options.spotInstanceTypes] - the logical name of a stack
 * parameter defining spot instance types as a comma-delimited list - or -
 * a comma-delimited list of parameter names defining several spot instance types
 * @param {string} [options.spotInstanceWeights] - the logical name of a stack
 * parameter defining spot instance weights as a comma-delimited list
 * @param {string} [options.onDemandWeight] - the logical name of a stack
 * parameter defining the weight of a single on-demand instance
 * @param {string} options.onDemandGroup - logical name of an on-demand auto
 * scaling group
 * @param {string} options.scaleDownPolicy - logical name of an auto
 * scaling policy that should be invoked to scale down the on-demand group when
 * spot capacity is fulfilled. **Important**: This cannot be a StepScaling policy.
 * @param {string} options.alarmTopic - logical name of an SNS topic to receive
 * alarm events if the spotswap function encounters any errors.

 * @returns {object} resources to include in your template
 */
function template(options) {
  if (!options)
    throw new Error('You must provide configuration options');
  if (!options.name)
    throw new Error('You must specify the application\'s name');
  if (!options.spotFleet && !options.spotGroup)
    throw new Error('You must specify the logical name of a spotFleet or a spotGroup');
  if (!options.onDemandGroup)
    throw new Error('You must specify the logical name of an on-demand auto scaling group');
  if (!options.scaleDownPolicy)
    throw new Error('You must specify the logical name of a scaling policy to reduce the size of the on-demand auto scaling group');
  if (!options.alarmTopic)
    throw new Error('You must specify the logical name of an SNS topic to receive error alarms');
  if (options.spotInstanceTypes || options.spotInstanceWeights || options.onDemandWeight) {
    if (!options.spotInstanceTypes || !options.spotInstanceWeights || !options.onDemandWeight)
      throw new Error('If any of spotInstanceTypes, spotInstanceWeights, onDemandWeight are specified, then they all must be specified');
  }
  if (!options.SpotSwapFunctionBucket)
    throw new Error('You must specify the AWS S3 bucket containing the SpotSwapFunction code');
  if (!options.SpotSwapFunctionS3Key)
    throw new Error('You must specify the AWS S3 key for the SpotSwapFunction code');

  options.handler = options.handler || 'node_modules/@mapbox/spotswap/index.spotswap';

  var SpotswapLambdaRole = {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: ['sts:AssumeRole']
          }
        ]
      },
      Policies: [
        {
          PolicyName: 'run-spotswap',
          PolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Action: ['logs:*'],
                Resource: '*'
              },
              {
                Effect: 'Allow',
                Action: [
                  'cloudformation:DescribeStacks',
                  'cloudwatch:GetMetricStatistics',
                  'autoscaling:DescribeAutoScalingGroups',
                  'autoscaling:SetDesiredCapacity',
                  'autoscaling:ExecutePolicy',
                  'ec2:DescribeSpotFleetInstances',
                  'ec2:DescribeSpotFleetRequests',
                  'ec2:DescribeInstances',
                  'ec2:DeleteTags'
                ],
                Resource: '*'
              }
            ]
          }
        }
      ]
    }
  };

  var env = {
    OnDemandGroup: cf.ref(options.onDemandGroup),
    OnDemandScaleDownPolicy: cf.ref(options.scaleDownPolicy)
  };

  if (options.spotFleet) {
    env.SpotFleet = cf.ref(options.spotFleet);
  } else {
    env.SpotGroup = cf.ref(options.spotGroup);
  }

  if (options.spotInstanceTypes) {
    env.SpotInstanceTypes = /,/.test(options.spotInstanceTypes) ?
      cf.join(' ', options.spotInstanceTypes.split(',').map(name => cf.ref(name))) :
      cf.ref(options.spotInstanceTypes);
    env.SpotInstanceWeights = cf.join(' ', cf.ref(options.spotInstanceWeights));
    env.OnDemandWeight = cf.ref(options.onDemandWeight);
  }

  var SpotswapFunction = {
    Type: 'AWS::Lambda::Function',
    Properties: {
      Code: {
        S3Bucket: options.SpotSwapFunctionBucket,
        S3Key: options.SpotSwapFunctionS3Key
      },
      Environment: {
        Variables: env
      },
      Role: cf.getAtt('SpotswapLambdaRole', 'Arn'),
      Description: 'Launch on-demand instances in response to spot price-out',
      Handler: options.handler,
      MemorySize: 128,
      Runtime: 'nodejs4.3',
      Timeout: 300
    }
  };

  var SpotswapSchedule = {
    Type: 'AWS::Events::Rule',
    Properties: {
      Description: 'Run spotswap function every minute',
      Name: cf.join(['spotswap-', cf.stackName]),
      ScheduleExpression: 'cron(0/1 * * * ? *)',
      Targets: [{ Arn: cf.getAtt('SpotswapFunction', 'Arn'), Id: 'SpotswapFunction' }]
    }
  };

  var SpotswapSchedulePermission = {
    Type: 'AWS::Lambda::Permission',
    Properties: {
      Action: 'lambda:InvokeFunction',
      FunctionName: cf.getAtt('SpotswapFunction', 'Arn'),
      Principal: 'events.amazonaws.com',
      SourceArn: cf.getAtt('SpotswapSchedule', 'Arn')
    }
  };

  if (typeof options.alarmTopic === 'object') var alarmRef = options.alarmTopic;
  var SpotswapFunctionErrorAlarm = {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      AlarmDescription: 'Errors from Lambda function responsible for healthcheck',
      Period: 60,
      EvaluationPeriods: 1,
      Statistic: 'Sum',
      Threshold: 2,
      ComparisonOperator: 'GreaterThanThreshold',
      Namespace: 'AWS/Lambda',
      Dimensions: [{ Name: 'FunctionName', Value: cf.ref('SpotswapFunction') }],
      MetricName: 'Errors',
      AlarmActions: [alarmRef || cf.ref(options.alarmTopic)],
      InsufficientDataActions: [alarmRef || cf.ref(options.alarmTopic)]
    }
  };

  return {
    Resources: {
      SpotswapLambdaRole,
      SpotswapFunction,
      SpotswapSchedule,
      SpotswapSchedulePermission,
      SpotswapFunctionErrorAlarm
    }
  };
}

function validate(templateBody) {
  // Not implemented yet
  return templateBody;
}
