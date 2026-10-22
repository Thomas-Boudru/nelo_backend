const { OpenAI } = require("openai");
const { z } = require("zod");

const { PROMPT_VERSION } = require("./dailyReportContextService");

let client = null;

const sectionSchema = z
  .object({
    text: z.string().trim().min(1).max(1200),
    evidenceKeys: z.array(z.string().trim().min(1).max(100)).min(1).max(8),
  })
  .strict();

const reportSchema = z
  .object({
    summary: z.string().trim().min(1).max(2400),
    observations: z.array(sectionSchema).max(2),
    suggestions: z.array(sectionSchema).max(2),
  })
  .strict();

function reportError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getDailyReportConfiguration() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  // Même modèle que le chat par défaut.
  // Une variable dédiée permet de le changer ultérieurement.
  const model =
    process.env.OPENAI_DAILY_REPORT_MODEL?.trim() ||
    process.env.OPENAI_CHAT_MODEL?.trim();

  if (!apiKey || !model) {
    throw reportError("DAILY_REPORT_AI_CONFIGURATION_ERROR");
  }

  return { apiKey, model };
}

function getClient(apiKey) {
  if (!client) {
    client = new OpenAI({
      apiKey,
      timeout: 60_000,
      maxRetries: 0,
    });
  }

  return client;
}

function buildJsonSchema(evidenceKeys) {
  const section = {
    type: "object",
    additionalProperties: false,
    properties: {
      text: {
        type: "string",
      },
      evidenceKeys: {
        type: "array",
        items: {
          type: "string",
          enum: evidenceKeys,
        },
      },
    },
    required: ["text", "evidenceKeys"],
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string",
      },
      observations: {
        type: "array",
        items: section,
      },
      suggestions: {
        type: "array",
        items: section,
      },
    },
    required: ["summary", "observations", "suggestions"],
  };
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readUsage(usage) {
  return {
    inputTokens: tokenCount(usage?.input_tokens),
    cachedInputTokens: tokenCount(usage?.input_tokens_details?.cached_tokens),
    outputTokens: tokenCount(usage?.output_tokens),
    reasoningTokens: tokenCount(usage?.output_tokens_details?.reasoning_tokens),
  };
}

function classifyError(error, signal) {
  if (signal?.aborted) {
    return "DAILY_REPORT_AI_ABORTED";
  }

  if (error?.name === "APIConnectionTimeoutError") {
    return "DAILY_REPORT_AI_TIMEOUT";
  }

  if (error?.status === 429) {
    return "DAILY_REPORT_AI_RATE_LIMITED";
  }

  if ([401, 403].includes(error?.status)) {
    return "DAILY_REPORT_AI_AUTH_ERROR";
  }

  if (error?.status >= 500) {
    return "DAILY_REPORT_AI_PROVIDER_UNAVAILABLE";
  }

  return Number.isInteger(error?.status)
    ? "DAILY_REPORT_AI_REQUEST_REJECTED"
    : "DAILY_REPORT_AI_CONNECTION_ERROR";
}

function validateDailyReportContent(value, evidenceKeys) {
  const result = reportSchema.safeParse(value);

  if (!result.success) {
    throw reportError("DAILY_REPORT_AI_INVALID_CONTENT");
  }

  const allowedKeys = new Set(evidenceKeys);
  const sections = [...result.data.observations, ...result.data.suggestions];

  for (const section of sections) {
    if (
      section.evidenceKeys.some((key) => !allowedKeys.has(key)) ||
      new Set(section.evidenceKeys).size !== section.evidenceKeys.length
    ) {
      throw reportError("DAILY_REPORT_AI_INVALID_EVIDENCE");
    }
  }

  return result.data;
}

/*
 * Appel interne au worker uniquement.
 *
 * Le contrôle Premium et la réservation PostgreSQL doivent
 * avoir été vérifiés avant cet appel.
 *
 * Cette fonction ne sauvegarde rien et ne relance jamais
 * automatiquement une requête.
 */
async function generateDailyReport({ context, signal } = {}) {
  if (
    context?.status !== "ready" ||
    context.promptVersion !== PROMPT_VERSION ||
    typeof context.instructions !== "string" ||
    !context.instructions.trim() ||
    !Array.isArray(context.input) ||
    context.input.length === 0 ||
    !Array.isArray(context.evidenceKeys) ||
    context.evidenceKeys.length === 0 ||
    context.evidenceKeys.some(
      (key) => typeof key !== "string" || !/^[a-z][a-z0-9_]{0,99}$/.test(key),
    )
  ) {
    throw reportError("DAILY_REPORT_AI_INVALID_CONTEXT");
  }

  if (signal?.aborted) {
    // Aucun appel n'a commencé.
    throw reportError("DAILY_REPORT_AI_ABORTED");
  }

  const { apiKey, model } = getDailyReportConfiguration();
  const openai = getClient(apiKey);

  const evidenceKeys = [...new Set(context.evidenceKeys)];
  const startedAt = Date.now();

  let response;

  try {
    response = await openai.responses.create(
      {
        model,
        instructions: context.instructions,
        input: context.input,

        store: false,

        // Même réglage que ton client de chat actuel.
        reasoning: {
          effort: "low",
        },

        max_output_tokens: 4000,

        text: {
          format: {
            type: "json_schema",
            name: "nelo_daily_report",
            strict: true,
            schema: buildJsonSchema(evidenceKeys),
          },
        },
      },
      { signal },
    );
  } catch (error) {
    /*
     * Une coupure ou un timeout ne prouve pas que le fournisseur
     * n'a rien généré. Le worker devra distinguer cet état
     * d'un refus explicite avant de décider d'une nouvelle tentative.
     */
    const outcomeUnknown =
      signal?.aborted ||
      !Number.isInteger(error?.status) ||
      error.status === 408 ||
      error.status >= 500;

    return {
      status: outcomeUnknown ? "unknown" : "failed",
      errorCode: classifyError(error, signal),
      report: null,

      call: {
        requestedModel: model,
        responseModel: null,
        providerRequestId: error?.requestID ?? null,
        providerResponseId: null,
        latencyMs: Date.now() - startedAt,
        ...readUsage(null),
      },
    };
  }

  // Conserver la consommation, même si le contenu est rejeté.
  const call = {
    requestedModel: model,
    responseModel: response.model ?? null,
    providerRequestId: response._request_id ?? null,
    providerResponseId: response.id ?? null,
    latencyMs: Date.now() - startedAt,
    ...readUsage(response.usage),
  };

  function rejected(errorCode) {
    return {
      status: "failed",
      errorCode,
      report: null,
      call,
    };
  }

  const hasRefusal = (response.output ?? []).some(
    (item) =>
      item.type === "message" &&
      (item.content ?? []).some((part) => part.type === "refusal"),
  );

  if (hasRefusal) {
    return rejected("DAILY_REPORT_AI_REFUSED");
  }

  if (response.status !== "completed") {
    return rejected(
      response.status === "incomplete"
        ? "DAILY_REPORT_AI_INCOMPLETE"
        : "DAILY_REPORT_AI_RESPONSE_FAILED",
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    return rejected("DAILY_REPORT_AI_INVALID_JSON");
  }

  let report;

  try {
    report = validateDailyReportContent(parsed, evidenceKeys);
  } catch (error) {
    return rejected(error.code || "DAILY_REPORT_AI_INVALID_CONTENT");
  }

  return {
    status: "completed",
    errorCode: null,
    report,
    call,
  };
}

module.exports = {
  generateDailyReport,
  getDailyReportConfiguration,
  validateDailyReportContent,
};
