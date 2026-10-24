const SLEEP_PREDICTION_VERSION = "1.0.0";

const SLEEP_PREDICTION_CONFIG = Object.freeze({
  // Historique utilisé pour personnaliser les prédictions.
  historyDays: 21,

  // Nombre de périodes d'éveil exploitables.
  minimumPersonalizedSamples: 4,
  minimumHighConfidenceSamples: 10,

  // Ancienneté maximale des données utilisées.
  maximumHistoryAgeDays: 21,

  // Fenêtre proposée autour de l'heure estimée.
  defaultWindowHalfWidthMinutes: 15,
  maximumWindowHalfWidthMinutes: 45,

  // Ajustement provisoire après une sieste courte.
  shortNapThresholdMinutes: 40,
  shortNapAdjustmentMinutes: 10,

  // Préparation et futures notifications.
  routineLeadMinutes: 20,
  notificationLeadMinutes: 20,
});

// Fenêtres d'éveil indicatives, exprimées en minutes.
// Elles seront personnalisées selon l'historique de l'enfant.
const AGE_WAKE_WINDOWS = Object.freeze([
  { minAgeDays: 0, maxAgeDays: 59, min: 45, max: 90 },
  { minAgeDays: 60, maxAgeDays: 89, min: 60, max: 120 },
  { minAgeDays: 90, maxAgeDays: 119, min: 75, max: 135 },
  { minAgeDays: 120, maxAgeDays: 149, min: 90, max: 150 },
  { minAgeDays: 150, maxAgeDays: 179, min: 105, max: 165 },
  { minAgeDays: 180, maxAgeDays: 239, min: 120, max: 195 },
  { minAgeDays: 240, maxAgeDays: 299, min: 135, max: 210 },
  { minAgeDays: 300, maxAgeDays: 364, min: 150, max: 240 },
  { minAgeDays: 365, maxAgeDays: 449, min: 180, max: 300 },
  { minAgeDays: 450, maxAgeDays: 549, min: 210, max: 330 },
]);

/**
 * Repères indicatifs de rythme de sommeil.
 *
 * Ces valeurs sont des paramètres de démarrage,
 * pas des normes médicales ni des obligations.
 *
 * Elles servent uniquement lorsque l'historique
 * personnel est encore insuffisant.
 */
const AGE_SLEEP_RHYTHMS = Object.freeze([
  {
    minAgeDays: 0,
    maxAgeDays: 89,
    expectedNaps: null,
    bedtimeFallbackEnabled: false,
  },
  {
    minAgeDays: 90,
    maxAgeDays: 149,
    expectedNaps: [3, 5],
    bedtimeFallbackEnabled: true,
  },
  {
    minAgeDays: 150,
    maxAgeDays: 239,
    expectedNaps: [2, 4],
    bedtimeFallbackEnabled: true,
  },
  {
    minAgeDays: 240,
    maxAgeDays: 364,
    expectedNaps: [2, 3],
    bedtimeFallbackEnabled: true,
  },
  {
    minAgeDays: 365,
    maxAgeDays: 549,
    expectedNaps: [1, 2],
    bedtimeFallbackEnabled: true,
  },
]);

const BEDTIME_PREDICTION_CONFIG = Object.freeze({
  minimumPersonalizedNights: 4,

  // Une seule nuit peut servir de repère provisoire,
  // mais ne suffit pas à confirmer une habitude.
  minimumFallbackNights: 1,

  // Écart maximal entre la prochaine fenêtre d'éveil
  // et l'horaire de coucher observé.
  bedtimeProximityMinutes: 75,

  // Ne pas proposer un coucher immédiatement
  // après la fin d'une sieste.
  minimumWakeBeforeBedtimeMinutes: 45,

  // Tolérance de variation de l'heure du coucher.
  maximumBedtimeVariationMinutes: 90,
});

function getAgeSleepRhythm(ageDays) {
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    return null;
  }

  const rule = AGE_SLEEP_RHYTHMS.find(
    (item) => ageDays >= item.minAgeDays && ageDays <= item.maxAgeDays,
  );

  return rule ?? null;
}

function getAgeWakeWindow(ageDays) {
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    return null;
  }

  const rule = AGE_WAKE_WINDOWS.find(
    (item) => ageDays >= item.minAgeDays && ageDays <= item.maxAgeDays,
  );

  if (!rule) return null;

  return {
    minimumMinutes: rule.min,
    maximumMinutes: rule.max,
    midpointMinutes: Math.round((rule.min + rule.max) / 2),
  };
}

function getSleepPredictionConfig() {
  return SLEEP_PREDICTION_CONFIG;
}

module.exports = {
  SLEEP_PREDICTION_VERSION,
  SLEEP_PREDICTION_CONFIG,
  AGE_WAKE_WINDOWS,
  AGE_SLEEP_RHYTHMS,
  BEDTIME_PREDICTION_CONFIG,
  getAgeWakeWindow,
  getAgeSleepRhythm,
  getSleepPredictionConfig,
};
