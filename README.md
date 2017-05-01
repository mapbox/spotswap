# spotswap

[![Build Status](https://travis-ci.com/mapbox/spotswap.svg?token=dkVUTgL9esjwon3C6rN3&branch=master)](https://travis-ci.com/mapbox/spotswap)

Spotswap manages spot priceouts for a spot AutoScaling Group or SpotFleet by activating backup on-demand capacity.

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
  * `TerminationOverrideFunction`: An environment variable that contains the AWS ARN of the [SpotswapFunction](#spotswapfunction)
- AWS API permissions
  * None (Does http://169.254.169.254/latest/meta-data/spot/termination-time need any AWS API permissions?)

## spotswap-cfn

`spotswap-cfn` provides the CloudFormation resources necessary for this system to run (mostly for [SpotswapFunction](#spotswapfunction)), and a validator to make sure you have everything you need in your CFN template. 

#### Usage
* Create a spotswap configuration object:
    ```
    var spotswapConfiguration = {
        name: <The application's name>,
        handler: <The path within the code bundle that provides spotswap's Lambda function code. The default setting assumes that spotswap is a dependency to your application => node_modules/@mapbox/spotswap/index.spotswap>,
        spotfleet: <If you are using a spot fleet, add the logical name of the spotfleet here>,
        spotGroup: <If you are using a spot autoscaling group, add the logical name of the spot auto-scaling group here>,
        spotInstanceTypes: <If you are using a spotfleet, The logical name of a stack parameter defining spot instance types as a comma-delimited list or a comma-delimited list of parameter names defining several spot instance types>,
        spotInstanceWeights: <The logical name of a stack parameter defining spot instance weights as a comma-delimited list. The ordering of the weights must correspond to the ordering of the instance types in the previous parameter>
        onDemandWeight: <The logical name of a stack parameter defining the weight of a single on-demand instance>,
        onDemandGroup: <The logical name of an on-demand auto scaling group>,
        scaleDownPolicy: <The logical name of an auto scaling policy that should be invoked to scale down the on-demand group when spot capacity is fulfilled. **Important**: This cannot be a StepScaling policy>,
        alarmTopic: <The logical name of an SNS topic to receive alarm events if the spotswap function encounters any errors>
    }
    ```
* Merge the spotswap template with your cloudformation template:
  * Assign your existing cloudformation template to a variable:

    `var myTemplate = <your cloudformation template>`

  * Use the `merge` method from `cloudfriend`

    ```
      var cf = require('cloudfriend');
      cf.merge(myTemplate, spotswap.cfn.template(spotswapConfiguration));
    ```

## SpotswapFunction

`SpotswapFunction` is a Lambda function that runs minutely, scanning a spot AutoScaling Group or SpotFleet for `SpotTermination` tags. If tags are found, the function scales up a backup on-demand AutoScaling Group by the number of tags it found, then deletes the tags. If no tags are found, the function evaluates the spot resource to determine if the backup on-demand group can scale down - if so, the function invokes a scale-down Scaling Policy for the on-demand group. This module provides the necessary cloudformation template to include the spotswap configuration in your cloudformation.

#### Usage

**Using cloudformation**
  * Include this module as part of your cloudformation template, and follow the instructions under [`spotswap-cfn`](#spotswap-cfn).

#### Requirements

- AWS API permissions
  * All required permissions are fulfilled by `spotswap-cfn`.
