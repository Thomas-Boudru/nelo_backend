const API_ORIGIN = "https://api.revenuecat.com";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revenueCatError(code, message, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function getRevenueCatConfiguration() {
  const apiKey = process.env.REVENUECAT_SECRET_API_KEY?.trim();
  const projectId = process.env.REVENUECAT_PROJECT_ID?.trim();
  const environment = process.env.BILLING_ENVIRONMENT?.trim();

  if (
    !apiKey ||
    !projectId ||
    !["sandbox", "production"].includes(environment)
  ) {
    throw revenueCatError(
      "REVENUECAT_CONFIGURATION_ERROR",
      "RevenueCat server configuration is incomplete.",
      500,
    );
  }

  return { apiKey, projectId, environment };
}

async function requestRevenueCat(url, apiKey) {
  let response;
  let body;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      body = await response.json();
    } else {
      // Consomme la réponse sans exposer son contenu dans les logs.
      await response.arrayBuffer();
    }
  } catch {
    throw revenueCatError(
      "REVENUECAT_UNAVAILABLE",
      "Unable to contact RevenueCat or read its response.",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw revenueCatError(
      "REVENUECAT_ACCESS_DENIED",
      "RevenueCat credentials or permissions are invalid.",
      500,
    );
  }

  if (response.status === 404) {
    // Ne pas interpréter un client introuvable comme une preuve
    // qu'il faut supprimer ses droits.
    throw revenueCatError(
      "REVENUECAT_RESOURCE_NOT_FOUND",
      "The RevenueCat resource was not found.",
      502,
    );
  }

  if (response.status === 429) {
    throw revenueCatError(
      "REVENUECAT_RATE_LIMITED",
      "RevenueCat is temporarily rate limiting requests.",
    );
  }

  if (!response.ok) {
    throw revenueCatError(
      "REVENUECAT_REQUEST_FAILED",
      "RevenueCat could not complete the request.",
    );
  }

  return body;
}

async function getRevenueCatSubscriptions({ userId }) {
  if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    throw revenueCatError(
      "INVALID_REQUEST",
      "A valid Nelo user ID is required.",
      400,
    );
  }

  const customerId = userId.toLowerCase();
  const { apiKey, projectId, environment } = getRevenueCatConfiguration();

  const pathname =
    `/v2/projects/${encodeURIComponent(projectId)}` +
    `/customers/${encodeURIComponent(customerId)}/subscriptions`;

  const subscriptions = [];
  const subscriptionIds = new Set();
  const visitedCursors = new Set();

  let cursor = null;

  // Une limite protège contre une pagination anormale.
  // Si elle est atteinte, on échoue sans retourner une liste partielle.
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(pathname, API_ORIGIN);

    url.searchParams.set("environment", environment);
    url.searchParams.set("limit", "100");

    if (cursor) {
      url.searchParams.set("starting_after", cursor);
    }

    const result = await requestRevenueCat(url, apiKey);

    if (result?.object !== "list" || !Array.isArray(result.items)) {
      throw revenueCatError(
        "REVENUECAT_INVALID_RESPONSE",
        "RevenueCat returned an invalid subscription list.",
        502,
      );
    }

    for (const subscription of result.items) {
      if (
        !subscription ||
        typeof subscription.id !== "string" ||
        !subscription.id ||
        subscription.environment !== environment
      ) {
        throw revenueCatError(
          "REVENUECAT_INVALID_SUBSCRIPTION",
          "RevenueCat returned invalid subscription information.",
          502,
        );
      }

      if (!subscriptionIds.has(subscription.id)) {
        subscriptionIds.add(subscription.id);
        subscriptions.push(subscription);
      }
    }

    if (result.next_page == null) {
      return {
        customerId,
        environment,
        subscriptions,
      };
    }

    if (
      typeof result.next_page !== "string" ||
      !result.next_page ||
      result.items.length === 0
    ) {
      throw revenueCatError(
        "REVENUECAT_INVALID_PAGINATION",
        "RevenueCat returned invalid pagination information.",
        502,
      );
    }

    let nextUrl;

    try {
      nextUrl = new URL(result.next_page, API_ORIGIN);
    } catch {
      throw revenueCatError(
        "REVENUECAT_INVALID_PAGINATION",
        "RevenueCat returned an invalid pagination URL.",
        502,
      );
    }

    // On ne suit jamais une URL externe avec la clé secrète.
    // Seul le curseur est repris, puis l'URL est reconstruite.
    const nextCursor = nextUrl.searchParams.get("starting_after");

    if (
      nextUrl.origin !== API_ORIGIN ||
      nextUrl.pathname !== pathname ||
      !nextCursor ||
      visitedCursors.has(nextCursor)
    ) {
      throw revenueCatError(
        "REVENUECAT_INVALID_PAGINATION",
        "RevenueCat returned inconsistent pagination information.",
        502,
      );
    }

    visitedCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw revenueCatError(
    "REVENUECAT_PAGINATION_LIMIT",
    "The complete RevenueCat subscription list could not be retrieved.",
    502,
  );
}

module.exports = {
  getRevenueCatSubscriptions,
};
