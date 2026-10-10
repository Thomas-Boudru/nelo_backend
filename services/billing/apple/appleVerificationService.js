const { getAppleBillingConnection } = require("./appleBillingClient");

function serviceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validateTransactionId(transactionId) {
  if (
    typeof transactionId !== "string" ||
    !/^[0-9]{1,64}$/.test(transactionId)
  ) {
    throw serviceError(
      "INVALID_APPLE_TRANSACTION_ID",
      "A valid Apple transaction ID is required.",
      400,
    );
  }
}

function validateSignedPayload(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 500000
  ) {
    throw serviceError(
      "INVALID_APPLE_SIGNED_PAYLOAD",
      "The Apple signed payload is invalid.",
      400,
    );
  }
}

async function getVerifiedAppleTransaction({ transactionId }) {
  validateTransactionId(transactionId);

  const { client, verifier } = getAppleBillingConnection();

  const response = await client.getTransactionInfo(transactionId);

  if (!response.signedTransactionInfo) {
    throw serviceError(
      "APPLE_TRANSACTION_DATA_MISSING",
      "Apple did not return signed transaction data.",
      502,
    );
  }

  const transaction = await verifier.verifyAndDecodeTransaction(
    response.signedTransactionInfo,
  );

  if (transaction.transactionId !== transactionId) {
    throw serviceError(
      "APPLE_TRANSACTION_MISMATCH",
      "The Apple transaction does not match the requested purchase.",
      502,
    );
  }

  return transaction;
}

async function getVerifiedAppleSubscriptionStatuses({ transactionId }) {
  validateTransactionId(transactionId);

  const { client, verifier } = getAppleBillingConnection();

  const response = await client.getAllSubscriptionStatuses(transactionId);

  const subscriptions = [];

  for (const group of response.data ?? []) {
    for (const item of group.lastTransactions ?? []) {
      if (!item.signedTransactionInfo || !item.signedRenewalInfo) {
        throw serviceError(
          "APPLE_SUBSCRIPTION_DATA_MISSING",
          "Apple did not return complete subscription data.",
          502,
        );
      }

      const transaction = await verifier.verifyAndDecodeTransaction(
        item.signedTransactionInfo,
      );

      const renewal = await verifier.verifyAndDecodeRenewalInfo(
        item.signedRenewalInfo,
      );

      if (
        !transaction.originalTransactionId ||
        transaction.originalTransactionId !== renewal.originalTransactionId ||
        transaction.originalTransactionId !== item.originalTransactionId
      ) {
        throw serviceError(
          "APPLE_SUBSCRIPTION_MISMATCH",
          "The Apple subscription data is inconsistent.",
          502,
        );
      }

      subscriptions.push({
        status: item.status,
        subscriptionGroupIdentifier: group.subscriptionGroupIdentifier,
        transaction,
        renewal,
      });
    }
  }

  return subscriptions;
}

async function verifyAppleNotification({ signedPayload }) {
  validateSignedPayload(signedPayload);

  const { verifier } = getAppleBillingConnection();

  const notification =
    await verifier.verifyAndDecodeNotification(signedPayload);

  let transaction = null;
  let renewal = null;

  if (notification.data?.signedTransactionInfo) {
    transaction = await verifier.verifyAndDecodeTransaction(
      notification.data.signedTransactionInfo,
    );
  }

  if (notification.data?.signedRenewalInfo) {
    renewal = await verifier.verifyAndDecodeRenewalInfo(
      notification.data.signedRenewalInfo,
    );
  }

  if (
    transaction &&
    renewal &&
    transaction.originalTransactionId !== renewal.originalTransactionId
  ) {
    throw serviceError(
      "APPLE_NOTIFICATION_MISMATCH",
      "The Apple notification data is inconsistent.",
      400,
    );
  }

  return {
    notification,
    transaction,
    renewal,
  };
}

module.exports = {
  getVerifiedAppleTransaction,
  getVerifiedAppleSubscriptionStatuses,
  verifyAppleNotification,
};
