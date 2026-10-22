const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDailyReportMetrics,
} = require("../services/dailyReports/buildDailyReportMetrics");

const CHILD_ID = "child-test";

function makeData(entries = []) {
  const days = Array.from({ length: 8 }, (_, index) => {
    const day = index + 1;

    return {
      dateKey: `2026-10-${String(day).padStart(2, "0")}`,
      startsAt: new Date(Date.UTC(2026, 9, day)).toISOString(),
      endsAt: new Date(Date.UTC(2026, 9, day + 1)).toISOString(),
    };
  });

  return {
    report: {
      childId: CHILD_ID,
      dateKey: "2026-10-08",
      timeZone: "UTC",
    },
    dataCutoffAt: "2026-10-09T07:00:00.000Z",
    days,
    entries,
  };
}

function entry(id, type, day, values = {}) {
  return {
    id,
    childId: CHILD_ID,
    type,
    startedAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    endedAt: null,
    deletedAt: null,
    ...values,
  };
}

test("absence de saisies : aucun total ou comparaison inventé", () => {
  const result = buildDailyReportMetrics(makeData());

  assert.equal(result.hasUsableData, false);
  assert.equal(result.current.bottles.status, "no_data");
  assert.equal(result.current.bottles.total, null);
  assert.equal(result.current.sleep.total, null);
  assert.equal(result.comparisons.bottles.available, false);
});

test("lait consommé, capacité du biberon et tirage restent distincts", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("bottle", "bottle", 8, {
        amountMl: 120,
        bottleCapacityMl: 240,
      }),
      entry("pumping", "pumping", 8, {
        leftAmountMl: 50,
        rightAmountMl: 40,
      }),
      entry("breastfeeding", "breastfeeding", 8, {
        leftDurationSeconds: 300,
        rightDurationSeconds: 120,
      }),
    ]),
  );

  assert.equal(result.current.bottles.total, 120);
  assert.equal(result.current.pumping.total, 90);
  assert.equal(result.current.breastfeeding.total, 420);

  assert.deepEqual(result.current.feedingMethods, ["bottle", "breastfeeding"]);
});

test("une quantité invalide empêche de présenter un total complet", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("valid", "bottle", 8, { amountMl: 120 }),
      entry("invalid", "bottle", 8, { amountMl: null }),
    ]),
  );

  assert.equal(result.current.bottles.status, "partial");
  assert.equal(result.current.bottles.recordedTotal, 120);
  assert.equal(result.current.bottles.total, null);
  assert.equal(result.comparisons.bottles.available, false);
});

test("sommeil traversant minuit réparti entre les journées", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("night", "sleep", 7, {
        startedAt: "2026-10-07T22:00:00.000Z",
        endedAt: "2026-10-08T06:00:00.000Z",
        sleepType: "night",
      }),
    ]),
  );

  assert.equal(result.current.sleep.total, 6 * 3600);
  assert.equal(result.previousDays[6].sleep.total, 2 * 3600);
});

test("sommeils chevauchants : pas de double comptage ni comparaison", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("sleep-1", "sleep", 8, {
        startedAt: "2026-10-08T10:00:00.000Z",
        endedAt: "2026-10-08T12:00:00.000Z",
        sleepType: "nap",
      }),
      entry("sleep-2", "sleep", 8, {
        startedAt: "2026-10-08T11:00:00.000Z",
        endedAt: "2026-10-08T13:00:00.000Z",
        sleepType: "nap",
      }),
    ]),
  );

  assert.equal(result.current.sleep.recordedClosedSeconds, 3 * 3600);
  assert.equal(result.current.sleep.overlaps, true);
  assert.equal(result.current.sleep.total, null);
  assert.equal(result.comparisons.sleep.available, false);
});

test("un minuteur ouvert n'est pas transformé en sommeil confirmé", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("open-sleep", "sleep", 8, {
        startedAt: "2026-10-08T22:00:00.000Z",
        endedAt: null,
        sleepType: "night",
      }),
    ]),
  );

  assert.equal(result.current.sleep.uncertainCount, 1);
  assert.equal(result.current.sleep.total, null);
  assert.equal(result.comparisons.sleep.available, false);
});

test("une couche contenant urine et selles compte pour un change", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("diaper", "diaper", 8, { content: "wetAndDirty" }),
      entry("potty", "potty", 8, { content: "pee" }),
    ]),
  );

  assert.equal(result.current.diapers.total, 1);
  assert.equal(result.current.diapers.contents.withUrine, 1);
  assert.equal(result.current.diapers.contents.withStool, 1);
  assert.equal(result.current.diapers.contents.dry, 0);
});

test("comparaison avec la veille et médiane de quatre jours", () => {
  const entries = [
    entry("day-4", "bottle", 4, { amountMl: 100 }),
    entry("day-5", "bottle", 5, { amountMl: 200 }),
    entry("day-6", "bottle", 6, { amountMl: 300 }),
    entry("day-7", "bottle", 7, { amountMl: 400 }),
    entry("day-8", "bottle", 8, { amountMl: 300 }),
  ];

  const result = buildDailyReportMetrics(makeData(entries));
  const comparison = result.comparisons.bottles;

  assert.equal(comparison.yesterday.reference, 400);
  assert.equal(comparison.yesterday.delta, -100);

  assert.equal(comparison.historical.dayCount, 4);
  assert.equal(comparison.historical.reference, 250);
  assert.equal(comparison.historical.delta, 50);
  assert.equal(comparison.historical.percent, 20);
});

test("moins de quatre jours : comparaison avec hier seulement", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("yesterday", "bottle", 7, { amountMl: 100 }),
      entry("current", "bottle", 8, { amountMl: 120 }),
    ]),
  );

  assert.equal(result.comparisons.bottles.yesterday.delta, 20);
  assert.equal(result.comparisons.bottles.historical, null);
});

test("changement de méthode d'alimentation : comparaison écartée", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("yesterday", "bottle", 7, { amountMl: 200 }),
      entry("current", "bottle", 8, { amountMl: 100 }),
      entry("breastfeeding", "breastfeeding", 8, {
        leftDurationSeconds: 300,
        rightDurationSeconds: 0,
      }),
    ]),
  );

  assert.equal(result.comparisons.bottles.yesterday, null);

  assert.ok(
    result.comparisons.bottles.excludedDays.some(
      (day) =>
        day.dateKey === "2026-10-07" &&
        day.reason === "feeding_methods_changed",
    ),
  );
});

test("croissance et dentition utilisent leur date métier", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("growth", "growth", 7, {
        measurementDate: "2026-10-08",
        weightKg: 8,
      }),
      entry("teething", "teething", 7, {
        eruptionDate: "2026-10-08",
        toothCodes: ["example-tooth"],
      }),
    ]),
  );

  assert.equal(result.current.events.growth.length, 1);
  assert.equal(result.current.events.teething.length, 1);
  assert.equal(result.previousDays[6].events.growth.length, 0);
});

test("les suppressions sont ignorées", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("deleted", "bottle", 8, {
        amountMl: 120,
        deletedAt: "2026-10-08T12:00:00.000Z",
      }),
    ]),
  );

  assert.equal(result.current.bottles.status, "no_data");
});

test("une entrée d'un autre enfant est refusée", () => {
  assert.throws(
    () =>
      buildDailyReportMetrics(
        makeData([
          entry("foreign", "bottle", 8, {
            childId: "another-child",
            amountMl: 120,
          }),
        ]),
      ),
    /identity mismatch/,
  );
});

test("une entrée en double est refusée", () => {
  const bottle = entry("duplicate", "bottle", 8, { amountMl: 120 });

  assert.throws(
    () => buildDailyReportMetrics(makeData([bottle, bottle])),
    /Duplicate/,
  );
});

test("une date invalide empêche les comparaisons", () => {
  const result = buildDailyReportMetrics(
    makeData([
      entry("yesterday", "bottle", 7, { amountMl: 100 }),
      entry("current", "bottle", 8, { amountMl: 120 }),
      entry("undated", "bottle", 8, {
        startedAt: "invalid",
        amountMl: 60,
      }),
    ]),
  );

  assert.equal(result.quality.unassignedEntryCount, 1);
  assert.equal(result.comparisons.bottles.available, false);
  assert.equal(result.comparisons.bottles.reason, "unassigned_entries");
});
