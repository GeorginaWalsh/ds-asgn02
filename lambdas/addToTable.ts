import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();

exports.handler = async (event: { Records: { s3: any; }[]; }) => {

  const s3Event = event.Records[0].s3;
  const key = s3Event.object.key;
  const tableName = process.env.TABLE_NAME;


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