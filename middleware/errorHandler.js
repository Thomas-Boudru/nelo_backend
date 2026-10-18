const PUBLIC_ERROR_CODES = new Set([
  "FEATURE_NOT_AVAILABLE",
  "FEATURE_QUOTA_EXCEEDED",
  "TOO_MANY_CHAT_REQUESTS",
  "TOO_MANY_CONVERSATIONS",
  "NELO_RESPONSE_IN_PROGRESS",
  "CONVERSATION_ARCHIVED",
  "CHAT_ATTACHMENTS_NOT_AVAILABLE",
]);

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const candidateStatus = error?.status ?? error?.statusCode;

  const status =
    Number.isInteger(candidateStatus) &&
    candidateStatus >= 400 &&
    candidateStatus <= 599
      ? candidateStatus
      : 500;

  const isServerError = status >= 500;

  const code =
    typeof error?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(error.code)
      ? error.code
      : "API_ERROR";

  if (isServerError) {
    // Ne pas journaliser le corps de la requête :
    // il peut contenir une conversation ou des données personnelles.
    console.error("[API error]", {
      code,
      status,
      method: req.method,
      route: req.route?.path ?? null,
    });
  }

  const responseError = {
    code: isServerError ? "INTERNAL_SERVER_ERROR" : code,

    message: isServerError
      ? "An unexpected error occurred."
      : typeof error?.message === "string" && error.message.trim()
        ? error.message
        : "The request could not be completed.",
  };

  // Transmettre uniquement les détails explicitement prévus
  // pour les erreurs métier de cette fonctionnalité.
  if (
    !isServerError &&
    PUBLIC_ERROR_CODES.has(code) &&
    error?.details !== undefined
  ) {
    responseError.details = error.details;
  }

  res.set("Cache-Control", "no-store");

  return res.status(status).json({
    error: responseError,
  });
}

module.exports = errorHandler;
