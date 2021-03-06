// dependencies
var AWS = require('aws-sdk');
var response = require('cfn-response');
var configservice = new AWS.ConfigService();
var current_region = process.env.AWS_REGION

function put_delivery_channel_and_start_recorder(dcParams, event) {
    console.log("Creating delivery channel");
    configservice.putDeliveryChannel(dcParams, function(err, data) {
        if (err) {
            console.log(err, err.stack);
            response.send(event, context, response.FAILED, {
                'Status': 'NEW'
            });
        } else {
            console.log(data);
            var params = {
                ConfigurationRecorderName: event.ResourceProperties.ConfigRecorderName
            };
            configservice.startConfigurationRecorder(params, function(err, data) {
                if (err) {
                    console.log(err, err.stack);
                    response.send(event, context, response.FAILED, {
                        'Status': 'NEW'
                    });
                } else {
                    console.log(data);
                    response.send(event, context, response.SUCCESS, {
                        'Status': 'NEW',
                        'FinalS3BucketConfig': event.ResourceProperties.S3BucketConfig,
                        'FinalS3BucketConfigArn': event.ResourceProperties.S3BucketConfigArn
                    });
                }
            });
        }
    });
}

function put_recorder_and_delivery_channel_and_start_recorder(crParamsNewRecorder, event, context) {
    configservice.putConfigurationRecorder(crParamsNewRecorder, function (err, data) {
        if (err) {
            console.log(err, err.stack);
            response.send(event, context, response.FAILED, {
                'Status': 'NEW'
            });
        } else {
            console.log(data);
            var dcParams = {
                DeliveryChannel: {
                    name: "CFN_delivery_channel",
                    configSnapshotDeliveryProperties: {
                        deliveryFrequency: "One_Hour"
                    },
                    s3BucketName: event.ResourceProperties.S3BucketConfig
                }
            };
            put_delivery_channel_and_start_recorder(dcParams, event, context);
        }
    });
}

exports.handler = function(event, context, callback) {
    console.log('Checking if a configuration recorder exists');
    configservice.describeConfigurationRecorders(null, function(err, data) {
        if (err) {
            console.log(err, err.stack);
            response.send(event, context, response.FAILED, {
                'Status': 'NEW'
            });
        } else {
            if(data.ConfigurationRecorders.length > 0) {
                // successful response
                var configurationRecorders = data;
                console.log('Found Configuration Recoder: ' + configurationRecorders.ConfigurationRecorders[0].name);
                console.log('Checking for the existence of a Delivery Channel');

                configservice.describeDeliveryChannels(null, function(err, data) {
                    if (err) {
                        console.log(err, err.stack);
                        response.send(event, context, response.FAILED, {
                            'Status': 'NEW'
                        });
                    } else {
                        if(data.DeliveryChannels.length > 0){
                            console.log('There is an existing delivery channel, checking if it has an s3 bucket');
                            deliveryChannels = data;
                            deliveryChannel = deliveryChannels.DeliveryChannels[0];
                            if (deliveryChannel.s3BucketName) {
                                if (deliveryChannel.s3KeyPrefix) {
                                    console.log('Bucket has a prefix. Full bucket name: ' + deliveryChannel.s3BucketName + '\\' + deliveryChannel.s3KeyPrefix);
                                    response.send(event, context, response.SUCCESS, {
                                        'Status': 'EXISTING',
                                        'ConfigurationRecorder': configurationRecorders.ConfigurationRecorders[0].name,
                                        'FinalS3BucketConfig': deliveryChannel.s3BucketName + '\\' + deliveryChannel.s3KeyPrefix,
                                        'FinalS3BucketConfigArn': "arn:aws:s3:::" + deliveryChannel.s3BucketName + '\\' + deliveryChannel.s3KeyPrefix
                                    });
                                } else {
                                    console.log('Bucket does not have a prefix. Full bucket name: ' + deliveryChannel.s3BucketName);
                                    response.send(event, context, response.SUCCESS, {
                                        'Status': 'EXISTING',
                                        'ConfigurationRecorder': configurationRecorders.ConfigurationRecorders[0].name,
                                        'FinalS3BucketConfig': deliveryChannel.s3BucketName,
                                        'FinalS3BucketConfigArn': "arn:aws:s3:::" + deliveryChannel.s3BucketName
                                    });
                                }
                            } else {
                                console.log('Recorder exists but delivery channel is only SNS. Attach s3 Bucket to delivery channel configuration.');
                                var dcParams = {
                                    DeliveryChannel: {
                                        name: "CFN_delivery_channel",
                                        configSnapshotDeliveryProperties: {
                                            deliveryFrequency: "One_Hour"
                                        },
                                        s3BucketName: event.ResourceProperties.S3BucketConfig
                                    }
                                };
                                put_delivery_channel_and_start_recorder(dcParams, event, context);
                                response.send(event, context, response.SUCCESS, {
                                    'Status': 'NEW',
                                    'FinalS3BucketConfig': event.ResourceProperties.S3BucketConfig ,
                                    'FinalS3BucketConfigArn': event.ResourceProperties.S3BucketConfigArn
                                });
                            }
                        } else {
                            console.log('There is a stale recorder, but no delivery channel. Delete this recorder before running the template again');

                            response.send(event, context, response.FAILED, {
                                'Status': 'NEW'
                            });
                        }
                    }
                })

            } else {
                console.log('No configuration recorded exists');

                configservice.describeDeliveryChannels(null, function(err, data) {
                    if (err) {
                        console.log(err, err.stack);
                        response.send(event, context, response.FAILED, {
                            'Status': 'NEW'
                        });
                    } else {
                        console.log(data);
                        if (data.DeliveryChannels.length > 0) {
                            console.log('Old delivery channel exists. Delete this old delivery channel before rerunning the template');

                            response.send(event, context, response.FAILED, {
                                'Status': 'NEW'
                            });
                        } else {
                            console.log('No old delivery channel. Creating new configuration recorder and delivery channel');
                            var crParamsNewRecorder = {};
                            if (current_region == "us-east-1") {
                                console.log('We are in us-east-1. Setting includeGlobalResourceTypes to true.');
                                crParamsNewRecorder = {
                                    ConfigurationRecorder: {
                                        name: event.ResourceProperties.ConfigRecorderName,
                                        recordingGroup: {
                                            allSupported: true,
                                            includeGlobalResourceTypes: true
                                        },
                                        roleARN: event.ResourceProperties.RecorderRoleArn
                                    }
                                };
                            } else {
                                console.log('We are not in us-east-1. Setting includeGlobalResourceTypes to false.');
                                crParamsNewRecorder = {
                                    ConfigurationRecorder: {
                                        name: event.ResourceProperties.ConfigRecorderName,
                                        recordingGroup: {
                                            allSupported: true,
                                            includeGlobalResourceTypes: false
                                        },
                                        roleARN: event.ResourceProperties.RecorderRoleArn
                                    }
                                };
                            }
                            put_recorder_and_delivery_channel_and_start_recorder(crParamsNewRecorder, event, context);
                        }
                    }
                });
            }
        }
    });
};