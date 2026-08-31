const path = require("path");
const { randomUUID } = require("crypto");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const {
  createSignedDownloadUrl,
  deleteObject,
  uploadObject,
} = require("../services/storage/r2StorageService");

async function checkR2Storage() {
  const storageKey = `diagnostics/${randomUUID()}.txt`;
  const expectedContent = "Nelo R2 storage test";
  let wasUploaded = false;

  try {
    await uploadObject({
      storageKey,
      body: Buffer.from(expectedContent, "utf8"),
      mimeType: "text/plain",
    });

    wasUploaded = true;

    const signedUrl = await createSignedDownloadUrl({
      storageKey,
      expiresIn: 60,
    });

    const response = await fetch(signedUrl);

    if (!response.ok) {
      throw new Error(
        `Signed download failed with HTTP status ${response.status}.`,
      );
    }

    const receivedContent = await response.text();

    if (receivedContent !== expectedContent) {
      throw new Error("The downloaded content does not match the upload.");
    }

    console.log("R2 upload and signed download successful.");
  } finally {
    if (wasUploaded) {
      await deleteObject(storageKey);
      console.log("Temporary R2 object deleted.");
    }
  }
}

checkR2Storage().catch((error) => {
  console.error("R2 storage test failed:", {
    name: error.name,
    message: error.message,
  });

  process.exitCode = 1;
});
