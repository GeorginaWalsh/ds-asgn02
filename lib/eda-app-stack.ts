import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";

import { Construct } from "constructs";

import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { SqsDestination } from "aws-cdk-lib/aws-lambda-destinations";
import { AttributeType, BillingMode, StreamViewType, Table } from "aws-cdk-lib/aws-dynamodb";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { DynamoDB, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

// const AWS = require("aws-sdk");
// const docClient = new AWS.DynamoDB.DocumentClient();


export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    const imageTable = new Table(this, "ImageTable", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "imageName", type: AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Images",
      stream: StreamViewType.NEW_IMAGE,
    })

    // Integration infrastructure
    
    const badImageQueue = new sqs.Queue(this, "img-bad-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      retentionPeriod: Duration.minutes(30),
    });

  const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
    receiveMessageWaitTime: cdk.Duration.seconds(10),
    deadLetterQueue: {
      queue: badImageQueue,
      maxReceiveCount: 2,
    },
  });

  const newImageTopic = new sns.Topic(this, "NewImageTopic", {
    displayName: "New Image topic",
  }); 


  const mailerQ = new sqs.Queue(this, "mailer-queue", {
    receiveMessageWaitTime: cdk.Duration.seconds(10),
  });

  const badMailerQ = new sqs.Queue(this, "bad-mailer-queue", {
    receiveMessageWaitTime: cdk.Duration.seconds(10),
  });

  // Lambda functions

  const processImageFn = new lambdanode.NodejsFunction(
    this,
    "ProcessImageFn",
    {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      onFailure: new SqsDestination(badImageQueue),
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        REGION: cdk.Aws.REGION,
        TABLE_NAME: imageTable.tableName,
      },
    },
  );

  const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
    runtime: lambda.Runtime.NODEJS_16_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/mailer.ts`,
  });

  const badMailerFn = new lambdanode.NodejsFunction(this, "bad-mailer-function", {
    runtime: lambda.Runtime.NODEJS_16_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/badMailer.ts`,
  });

  const addToTableFn = new lambdanode.NodejsFunction(this, "add-to-table-function", {
    architecture: lambda.Architecture.ARM_64,
    runtime: lambda.Runtime.NODEJS_16_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(15),
    entry: `${__dirname}/../lambdas/addToTable.ts`,
    handler: "handler",
    environment: {
      REGION: cdk.Aws.REGION,
      TABLE_NAME: imageTable.tableName,
    },
  });

  // Event triggers

  imagesBucket.addEventNotification(
    s3.EventType.OBJECT_CREATED,
    new s3n.SnsDestination(newImageTopic)  // Changed
);


  newImageTopic.addSubscription(
    new subs.SqsSubscription(imageProcessQueue, {
      filterPolicyWithMessageBody: {
        Records: sns.FilterOrPolicy.policy({
          s3: sns.FilterOrPolicy.policy({
            object: sns.FilterOrPolicy.policy({
              key: sns.FilterOrPolicy.filter(
                sns.SubscriptionFilter.stringFilter({
                  matchPrefixes: ["*.jpeg", "*.png"],
                }),

              ),
            }),
          }),
        })
      },
      rawMessageDelivery: true,
    }),
  );

  newImageTopic.addSubscription(
    new subs.SqsSubscription(mailerQ),
    );

    const newImageMailEventSource = new events.SqsEventSource(mailerQ, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    }); 

    const newBadImageMailEventSource = new events.SqsEventSource(badMailerQ, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    }); 

    mailerFn.addEventSource(newImageMailEventSource);

    badMailerFn.addEventSource(newBadImageMailEventSource);

    processImageFn.addEventSource(
      new events.DynamoEventSource(imageTable, {
        startingPosition: StartingPosition.LATEST,
      })
    )

    addToTableFn.addEventSource(
      new events.DynamoEventSource(imageTable, {
        startingPosition: StartingPosition.LATEST,
      })
    )

    // processImageFn.addEventSource(
    //   new events.PutCommand( {
    //       TableName: process.env.REVIEW_TABLE_NAME,
    //       Item:   key,
    //     })
    // )

  // exports.handler = async (event: { Records: { s3: any; }[]; }) => {
  // const s3Event = event.Records[0].s3;
  // const key = s3Event.object.key;
    // const key = 
    // const addItemToTable = new PutCommand( {
    //   TableName: process.env.REVIEW_TABLE_NAME,
    //   Item:   key,
    // })


  // Permissions

  imagesBucket.grantRead(processImageFn);

  imageTable.grantReadWriteData(processImageFn);
  imageTable.grantReadWriteData(addToTableFn);
  // imageTable.grantWriteData(newImageTopic);

  mailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );

  badMailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );

  // Output
  
  new cdk.CfnOutput(this, "bucketName", {
    value: imagesBucket.bucketName,
  });
  }
}

 
// const ddbDocClient = new DynamoDBClient({ region: process.env.REGION });

// exports.handler = async (event: { Records: { s3: any; }[]; }) => {
//   // Get the S3 event
//   const s3Event = event.Records[0].s3;

//   // Get the key of the new object
//   const key = s3Event.object.key;

//   // Get the table name from the environment variable
//   const tableName = process.env.TABLE_NAME;

//   // Put the key into the table
//   const commandOutput = await ddbDocClient.send(
//     new PutCommand({
//       TableName: tableName,
//       Item:  key ,
//     })
//   );
// }