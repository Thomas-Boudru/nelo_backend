const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const { ListObjectsV2Command } = require("@aws-sdk/client-s3");

const {
  getR2BucketName,
  getR2Client,
} = require("../services/storage/r2Client");

async function checkR2Connection() {
  const bucketName = getR2BucketName();
  const client = getR2Client();

  await client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      MaxKeys: 1,
    }),
  );

  console.log(`R2 connection successful for bucket: ${bucketName}`);
}

checkR2Connection().catch((error) => {
  console.error("R2 connection failed:", {
    name: error.name,
    message: error.message,
  });

  process.exitCode = 1;
});
