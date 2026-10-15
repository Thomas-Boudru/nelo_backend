const { OpenAI } = require("openai");
const { z } = require("zod");

let client = null;

const answerSchema = z
  .object({
    content: z.string().trim().min(1).max(16000),
    suggestions: z.array(z.string().trim().min(1).max(200)).max(3),
  })
  .strict();

const answerJsonSchema = {
  type: "object",
  additionalProperties: false,

  properties: {
    content: {
      type: "string",
      description: "The answer shown to the parent.",
    },

    suggestions: {
      type: "array",
      description:
        "Zero to three short follow-up questions the parent could ask.",
      items: {
        type: "string",
      },
    },
  },

  required: ["content", "suggestions"],
};

function configurationError(message) {
  const error = new Error(message);
  error.code = "NELO_AI_CONFIGURATION_ERROR";
  error.status = 500;
  return error;
}

function getConfiguration() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_CHAT_MODEL?.trim();

  if (!apiKey) {
    throw configurationError("Missing OPENAI_API_KEY.");
  }

  if (!model) {
    throw configurationError("Missing OPENAI_CHAT_MODEL.");
  }

  return { apiKey, model };
}

function getClient(apiKey) {
  if (!client) {
    client = new OpenAI({
      apiKey,
      timeout: 60_000,

      // Chaque tentative sera comptabilisée par notre traitement.
      // Évite les nouvelles tentatives invisibles du SDK.
      maxRetries: 0,
    });
  }

  return client;
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

function classifyRequestError(error, signal) {
  if (signal?.aborted) {
    return "NELO_AI_REQUEST_ABORTED";
  }

  if (error?.name === "APIConnectionTimeoutError") {
    return "NELO_AI_TIMEOUT";
  }

  if (error?.status === 429) {
    return "NELO_AI_RATE_LIMITED";
  }

  if ([401, 403].includes(error?.status)) {
    return "NELO_AI_PROVIDER_AUTH_ERROR";
  }

  if (error?.status >= 500) {
    return "NELO_AI_PROVIDER_UNAVAILABLE";
  }

  if (Number.isInteger(error?.status)) {
    return "NELO_AI_REQUEST_REJECTED";
  }

  return "NELO_AI_CONNECTION_ERROR";
}

/*
 * Fonction interne au backend.
 *
 * instructions : instructions construites par notre serveur.
 * input : contexte et messages autorisés, construits par notre serveur.
 * signal : permet au traitement d'interrompre l'attente.
 *
 * Ne pas exposer directement ces paramètres dans une route publique.
 */
async function generateNeloAnswer({ instructions, input, signal } = {}) {
  const { apiKey, model } = getConfiguration();

  if (
    typeof instructions !== "string" ||
    !instructions.trim() ||
    !Array.isArray(input) ||
    input.length === 0
  ) {
    throw configurationError("Invalid Nelo AI input.");
  }

  const openai = getClient(apiKey);
  const startedAt = Date.now();

  let response;

  try {
    response = await openai.responses.create(
      {
        model,
        instructions,
        input,

        store: false,

        reasoning: {
          effort: "low",
        },

        max_output_tokens: 4000,

        text: {
          format: {
            type: "json_schema",
            name: "nelo_answer",
            strict: true,
            schema: answerJsonSchema,
          },
        },
      },
      {
        signal,
      },
    );
  } catch (error) {
    /*
     * Une interruption ou un timeout ne prouve pas que le
     * fournisseur n'a rien exécuté : consommation inconnue.
     */
    const outcomeUnknown =
      signal?.aborted ||
      !Number.isInteger(error?.status) ||
      error.status === 408 ||
      error.status >= 500;

    return {
      status: outcomeUnknown ? "unknown" : "failed",
      errorCode: classifyRequestError(error, signal),
      answer: null,

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

  /*
   * Conserver les compteurs même si la réponse est ensuite
   * refusée, incomplète ou inutilisable.
   */
  const call = {
    requestedModel: model,
    responseModel: response.model ?? null,
    providerRequestId: response._request_id ?? null,
    providerResponseId: response.id ?? null,
    latencyMs: Date.now() - startedAt,

    ...readUsage(response.usage),
  };

  const rejected = (errorCode) => ({
    status: "failed",
    errorCode,
    answer: null,
    call,
  });

  if (response.status !== "completed") {
    return rejected(
      response.status === "incomplete"
        ? "NELO_AI_RESPONSE_INCOMPLETE"
        : "NELO_AI_RESPONSE_FAILED",
    );
  }

  const hasRefusal = (response.output ?? []).some(
    (item) =>
      item.type === "message" &&
      (item.content ?? []).some((part) => part.type === "refusal"),
  );

  if (hasRefusal) {
    return rejected("NELO_AI_RESPONSE_REFUSED");
  }

  let parsed;

  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    return rejected("NELO_AI_INVALID_RESPONSE");
  }

  const validated = answerSchema.safeParse(parsed);

  if (!validated.success) {
    return rejected("NELO_AI_INVALID_RESPONSE");
  }

  return {
    status: "completed",
    errorCode: null,

    answer: {
      content: validated.data.content,
      suggestions: validated.data.suggestions,
    },

    call,
  };
}

module.exports = {
  generateNeloAnswer,
};
