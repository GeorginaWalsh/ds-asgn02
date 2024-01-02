/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
// import { sharp } from "/opt/nodejs/sharp-utils";
import {
  GetObjectCommand,
  PutObjectCommandInput,
  GetObjectCommandInput,
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

import { DynamoDB, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const s3 = new S3Client();

const ddbClient = new DynamoDBClient({ region: process.env.REGION });

export const handler: SQSHandler = async (event) => {
  console.log("Event ", event);

  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);
    console.log('Raw SNS message ',JSON.stringify(recordBody))

    if (recordBody.Records) {

      for (const messageRecord of recordBody.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;

        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

        // Infer the image type from the file suffix.
        const typeMatch = srcKey.match(/\.([^.]*)$/);

        if (!typeMatch) {
          console.log("Could not determine the image type.");
          throw new Error("Could not determine the image type. ");
        }
        // Check that the image type is supported
        const imageType = typeMatch[1].toLowerCase();
        if (imageType != "jpeg" && imageType != "png") {
          console.log(`Unsupported image type: ${imageType}`);
          throw new Error("Unsupported image type: ${imageType. ");
        }
        // process image upload 

        const imageName = s3e.object.key;
        // const params = {
        //   TableName: process.env.TABLE_NAME, // Get the table name from the environment variable
        //   Item: {
        //     imageName: imageName, 
        //   }
        // };

        try {
          await ddbClient.send(
                new PutCommand({
                  TableName: process.env.TABLE_NAME,
                  Item:  imageName ,
                })
              );
          console.log(`Successfully processed image ${imageName}`);
        } catch (error) {
          console.error(`Failed to process image ${imageName}: ${error}`);
        }

        const docClient = new DynamoDBClient({ region: process.env.REGION });

        const command = new PutCommand({
          TableName: process.env.TABLE_NAME,
          Item: marshall(imageName),
        });

        docClient.send(command)
        .then((data) => {
          // Check if the attributes property is defined and use an empty object as a fallback
          const attributes = data.Attributes ?? {};
          // Unmarshall the attributes
          const response = unmarshall(attributes);
          console.log("Success:", response);
        })
        .catch((error) => {
          console.error("Error:", error);
        });
      }
    }
  }
};


const ddbDocClient = createDDbDocClient()

exports.handler = async (event: { Records: { s3: any; }[]; }) => {
  // Get the S3 event
  const s3Event = event.Records[0].s3;

  // Get the key of the new object
  const key = s3Event.object.key;

  // Get the table name from the environment variable
  const tableName = process.env.TABLE_NAME;

  // Put the key into the table
  const commandOutput = await ddbDocClient.send(
    new PutCommand({
      TableName: tableName,
      Item:  key ,
    })
  );
}

function createDDbDocClient() {
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });
  const marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  };
  const unmarshallOptions = {
    wrapNumbers: false,
  };
  const translateConfig = { marshallOptions, unmarshallOptions };
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}