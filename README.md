# spotswap

[![Build Status](https://travis-ci.com/mapbox/spotswap.svg?token=dkVUTgL9esjwon3C6rN3&branch=master)](https://travis-ci.com/mapbox/spotswap)

Spotswap manages spot priceouts for a spot AutoScaling Group or SpotFleet by activating backup on-demand capacity. It contains three service components, which are described below.

---------

## spotswap-poll

`spotswap-poll` is an upstart service that runs on each spot EC2 instance in a spot AutoScaling Group or Spot Fleet. It polls the termination notification endpoint, and upon finding a termination notice, will tag the instance with a `SpotTermination: true` tag.

#### Usage

```sh
./node_modules/.bin/spotswap-install
```

Call `spotswap-install` if globally linked or call directly from npm installed bin path:

#### Requirements

**Dependencies**
- awscli
- upstart

**Run-time environment**

- Environment variables:
  * `TerminationOverrideFunction` (optional): An environment variable that contains the AWS ARN of a lambda function that can be invoked whenever a spot EC2 receives a termination notification, instead of directly terminating the instance. If this is not specified, any instances with `SpotTermination` tags will be terminated.

- AWS API permissions
  * The main `Role` resource in your CloudFormation template used to create, update or delete instances should contain permissions to create EC2 tags. For example:

  ```
  Role: {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: [
              'sts:AssumeRole'
            ],
            Effect: 'Allow',
            Principal: {
              Service: [
                'ec2.amazonaws.com'
              ]
            }
          }
        ]
      },
      Policies: [
        {
          PolicyName: 'tag-instances',
          PolicyDocument: {
            Statement: [
              {
                Action: ['ec2:CreateTags'],
                Effect: 'Allow',
                Resource: '*'
              }
            ]
          }
        }]
    }
  }
  ```
  * If you are using the `TerminationOverrideFunction` environment variable, you also need to include the permissions to invoke this function as part of your cloudformation template.


## spotswap-cfn

`spotswap-cfn` provides the CloudFormation resources necessary for this system to run (mostly for [SpotswapFunction](#spotswapfunction)), and a validator to make sure you have everything you need in your CFN template. 

#### Usage

  ```javascript
  var cf = require('@mapbox/cloudfriend');
  var spotswap = require('@mapbox/spotswap');

  var spotswapConfiguration = {
    name: 'myApplication',
    onDemandGroup: 'OnDemandGroup',
    spotGroup: 'SpotGroup',
    scaleDownPolicy: 'ScaleDownPolicy',
    alarmTopic: 'AlarmEmail',
    SpotSwapFunctionBucket: 'spotswap-code',
    SpotSwapFunctionS3Key: 'lambda.zip'
  };

  var myTemplate = {
    Parameters: {
      GitSha: { Type: 'String' },
      AlarmEmail: { Type: 'String' },
      OnDemandGroup: { Type: 'String' }
    },
    Resources: {
      MyBucket: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          Name: 'my-bucket'
        }
      },
      LaunchConfigOnDemand: {
        Type : "AWS::AutoScaling::LaunchConfiguration",
        Properties : {
          ImageId : {
            'Fn::FindInMap' : [
              'AWSRegionArch2AMI',
              { 'Ref' : 'AWS::Region' },
              {
                 'Fn::FindInMap' : [
                    'AWSInstanceType2Arch', 'c3.8xlarge', 'Arch'
                 ]
              }
            ]
          },
          InstanceType : 'c3.8xlarge'
        }
      },
      LaunchConfigSpot: {
        Type : "AWS::AutoScaling::LaunchConfiguration",
        Properties : {
          ImageId : {
            'Fn::FindInMap' : [
              'AWSRegionArch2AMI',
              { 'Ref' : 'AWS::Region' },
              {
                 'Fn::FindInMap' : [
                    'AWSInstanceType2Arch', 'c3.8xlarge', 'Arch'
                 ]
              }
            ]
          },
          InstanceType : 'c3.8xlarge',
          SpotPrice: {
            'Fn::FindInMap' : [
                PriceMap, 'c3.8xlarge', 'price'
            ]
          }
        }
      },
      OnDemandGroup: {
        Type : 'AWS::AutoScaling::AutoScalingGroup',
        Properties : {
          AvailabilityZones : { 'Fn::GetAZs' : { 'Ref' : 'AWS::Region' } },
          LaunchConfigurationName : { 'Ref' : 'LaunchConfigOnDemand' },
          MaxSize : 1,
          MinSize : 0
        },
        UpdatePolicy : {
          AutoScalingRollingUpdate : {
            MinInstancesInService : 0,
            MaxBatchSize : 5,
            PauseTime : 'PT10M',
            WaitOnResourceSignals : 'true'
          }
        }
      },
      SpotGroup: {
        Type: 'AWS::AutoScaling::AutoScalingGroup',
        Properties: {
          AvailabilityZones: { 'Fn::GetAZs' : { 'Ref' : 'AWS::Region' } },
          LaunchConfigurationName: { Ref: 'LaunchConfigSpot' },
          MaxSize: 3,
          MinSize: 1,
      }
    }
  };

  cf.merge(myTemplate, spotswap.cfn.template(spotswapConfiguration));
  ```

The Spotswap configuration object:

| Name| Default | Description | Required? |
|---------|----------|----------|-------------|
| name|  | The application's name | Yes |
| handler| `node_modules/@mapbox/spotswap/index.spotswap` | The path within the code bundle that provides spotswap's Lambda function code. |
| spotFleet| | If you are using a spot fleet, add the logical name of the spotfleet here. | Either the `spotFleet` option or the `spotGroup` option is required. | No |
| spotGroup| | If you are using a spot autoscaling group, add the logical name of the spot auto-scaling group here. | Either the `spotFleet` option or the `spotGroup` option is required. |
| spotInstanceTypes| | The logical name of a stack parameter defining spot instance types as a comma-delimited list or a comma-delimited list of parameter names defining several spot instance types | Required if you are using a spotfleet
| spotInstanceWeights| | The logical name of a stack parameter defining spot instance weights as a comma-delimited list. The ordering of the weights must correspond to the ordering of the instance types in the previous parameter | Required if you are using a spotfleet |
| onDemandWeight| | The logical name of a stack parameter defining the weight of a single on-demand instance | Required if you are using a spotfleet |
| onDemandGroup| | The logical name of an on-demand auto scaling group | Yes |
| scaleDownPolicy| | The logical name of an auto scaling policy that should be invoked to scale down the on-demand group when spot capacity is fulfilled. **Important**: This cannot be a StepScaling policy | Yes |
| alarmTopic| | The logical name of an SNS topic to receive alarm events if the spotswap function encounters any errors | Yes |
| SpotSwapFunctionBucket | | The name of the AWS S3 bucket containing the SpotSwapFunction code | Yes | 
| SpotSwapFunctionS3Key | | The name of the AWS S3 key containing the SpotSwapFunction code | Yes | 

## SpotswapFunction

`SpotswapFunction` is a Lambda function that runs minutely, scanning a spot AutoScaling Group or SpotFleet for `SpotTermination` tags. If tags are found, the function scales up a backup on-demand AutoScaling Group by the number of tags it found, then deletes the tags. If no tags are found, the function evaluates the spot resource to determine if the backup on-demand group can scale down - if so, the function invokes a scale-down Scaling Policy for the on-demand group. This module provides the necessary CloudFormation template to include the spotswap configuration in your CloudFormation.

#### Usage

* Include this module as part of your CloudFormation template, and follow the instructions under [`spotswap-cfn`](#spotswap-cfn). You can also use [cfn-config](https://github.com/mapbox/cfn-config) to easily create, update and delete your cloudformation stacks. 

#### Requirements

- AWS API permissions
  * All required permissions are fulfilled by `spotswap-cfn`.

----------------------------

## CONTRIBUTORS

At the time this package was moved to becoming open source, contributors were:

* @arunasank
* @emilymcafee
* @emilymdubois
* @KaiBot3000
* @rclark
* @xrwang
* @yhahn
