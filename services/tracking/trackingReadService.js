const standardFoods = require("../../data/standardFoodCatalog.json");

const { createSignedDownloadUrl } = require("../storage/r2StorageService");

const { createTrackingError } = require("./trackingAccess");

const DETAIL_TABLES = {
  bottle: "bottle_details",
  breastfeeding: "breastfeeding_details",
  pumping: "pumping_details",
  solids: "solid_feeding_details",
  sleep: "sleep_details",
  diaper: "toileting_details",
  potty: "toileting_details",
  mood: "mood_details",
  medication: "medication_details",
  vaccine: "vaccination_details",
  temperature: "temperature_details",
  symptoms: "symptom_details",
  teething: "teething_details",
  growth: "growth_details",
};

function toIso(value) {
  return value == null ? null : new Date(value).toISOString();
}

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function mapBaseEntry(row) {
  return {
    id: row.id,
    childId: row.child_id,
    type: row.entry_type,
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    note: row.note_text ?? "",
    source: row.source,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    deletedByUserId: row.deleted_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIso(row.deleted_at),
    version: row.version,
  };
}

function mapDetails(entry, details, foods, reminder) {
  const date = entry.startedAt;

  switch (entry.type) {
    case "bottle":
      return {
        feedingDate: date,
        amountMl: numberOrNull(details.amount_ml),
        bottleCapacityMl: numberOrNull(details.bottle_capacity_ml),
        milkType: details.content_type,
      };

    case "breastfeeding":
      return {
        feedingDate: date,
        leftDurationSeconds: Number(details.left_duration_seconds),
        rightDurationSeconds: Number(details.right_duration_seconds),
        firstSide: details.first_side,
        lastSide: details.last_side,
      };

    case "pumping": {
      const leftAmountMl = Number(details.left_amount_ml);
      const rightAmountMl = Number(details.right_amount_ml);

      return {
        pumpingDate: date,
        leftAmountMl,
        rightAmountMl,
        totalAmountMl: Math.round((leftAmountMl + rightAmountMl) * 1000) / 1000,
      };
    }

    case "solids":
      return {
        feedingDate: date,
        amountEaten: details.amount_eaten,
        reaction: details.reaction,
        appreciation: details.reaction,
        foods,
      };

    case "sleep":
      return {
        sleepType: details.sleep_type,
        endedByUserId: details.ended_by_user_id,
        durationSeconds: entry.endedAt
          ? Math.max(
              0,
              Math.floor((Date.parse(entry.endedAt) - Date.parse(date)) / 1000),
            )
          : null,
      };

    case "diaper":
    case "potty":
      return {
        [entry.type === "diaper" ? "diaperDate" : "pottyDate"]: date,
        content: details.result,
        consistency: details.consistency,
        isAccident: details.is_accident,
      };

    case "mood":
      return {
        moodDate: date,
        mood: details.mood_type,
      };

    case "medication":
      return {
        medicationDate: date,
        medicationId:
          details.custom_medication_id ?? details.catalog_medication_code,
        medicationName: details.medication_name_snapshot,
        isCustomMedication: details.custom_medication_id != null,
        amount: Number(details.amount_value),
        unit: details.amount_unit,
      };

    case "vaccine":
      return {
        vaccineDate: date,
        vaccineId: details.custom_vaccine_id ?? details.catalog_vaccine_code,
        vaccineName: details.vaccine_name_snapshot,
        isCustomVaccine: details.custom_vaccine_id != null,
        dose:
          details.dose_kind === "numbered"
            ? details.dose_number
            : details.dose_kind === "booster"
              ? "booster"
              : null,
        nextDoseDate: reminder?.next_dose_date ?? null,
        reminderId: reminder?.id ?? null,
        reminderStatus: reminder?.status ?? null,
      };

    case "temperature": {
      const temperatureCelsius = Number(details.temperature_celsius);

      return {
        measuredAt: date,
        temperatureCelsius,
        inputValue: numberOrNull(details.input_value),
        inputUnit: details.input_unit,
        measurementSite: details.measurement_site,

        // Compatibilité avec tes formulaires existants.
        temperature: temperatureCelsius,
        value: temperatureCelsius,
        unit: "celsius",
        location: details.measurement_site,
        measurementLocation: details.measurement_site,
      };
    }

    case "symptoms":
      return {
        observedAt: date,
        symptoms: details.symptom_codes,
      };

    case "teething":
      return {
        toothCodes: details.tooth_codes,
        eruptionDate: details.eruption_date_text,
      };

    case "growth":
      return {
        measurementDate: details.measurement_date_text,
        weightKg:
          details.weight_g == null ? null : Number(details.weight_g) / 1000,
        heightCm:
          details.height_mm == null ? null : Number(details.height_mm) / 10,
        headCircumferenceCm:
          details.head_circumference_mm == null
            ? null
            : Number(details.head_circumference_mm) / 10,
      };

    case "note":
      return {
        notedAt: date,
      };

    default:
      throw createTrackingError(
        "UNSUPPORTED_TRACKING_TYPE",
        "Unsupported tracking type.",
        500,
      );
  }
}

/*
 * Fonction interne :
 * l'appelant doit vérifier les droits d'accès à childId.
 * database doit être le client de sa transaction de lecture.
 */
async function readTrackingPage({ database, childId, rows }) {
  if (rows.length === 0) {
    return [];
  }

  const detailsById = new Map();
  const foodsById = new Map();
  const remindersById = new Map();
  const photoRowsById = new Map();

  const activeRows = rows.filter((row) => !row.deleted_at);
  const activeIds = activeRows.map((row) => row.id);

  const idsByTable = new Map();

  for (const row of activeRows) {
    if (row.entry_type === "note") {
      continue;
    }

    const table = DETAIL_TABLES[row.entry_type];

    if (!table) {
      throw createTrackingError(
        "UNSUPPORTED_TRACKING_TYPE",
        "Unsupported tracking type.",
        500,
      );
    }

    if (!idsByTable.has(table)) {
      idsByTable.set(table, []);
    }

    idsByTable.get(table).push(row.id);
  }

  for (const [table, ids] of idsByTable) {
    // Les noms de tables viennent uniquement de DETAIL_TABLES.
    let extraColumns = "";

    if (table === "growth_details") {
      extraColumns =
        ", to_char(d.measurement_date, 'YYYY-MM-DD') AS measurement_date_text";
    }

    if (table === "teething_details") {
      extraColumns =
        ", to_char(d.eruption_date, 'YYYY-MM-DD') AS eruption_date_text";
    }

    const result = await database.query(
      `
        SELECT d.* ${extraColumns}
        FROM ${table} d
        INNER JOIN tracking_entries t
          ON t.id = d.tracking_entry_id
        WHERE t.child_id = $1
          AND t.id = ANY($2::uuid[])
      `,
      [childId, ids],
    );

    for (const detail of result.rows) {
      detailsById.set(detail.tracking_entry_id, detail);
    }
  }

  const solidIds = activeRows
    .filter((row) => row.entry_type === "solids")
    .map((row) => row.id);

  if (solidIds.length > 0) {
    const result = await database.query(
      `
        SELECT i.*
        FROM solid_feeding_items i
        INNER JOIN tracking_entries t
          ON t.id = i.tracking_entry_id
        WHERE t.child_id = $1
          AND t.id = ANY($2::uuid[])
        ORDER BY i.sort_order ASC, i.id ASC
      `,
      [childId, solidIds],
    );

    for (const item of result.rows) {
      const entryId = item.tracking_entry_id;

      if (!foodsById.has(entryId)) {
        foodsById.set(entryId, []);
      }

      foodsById.get(entryId).push({
        id: item.id,
        foodId: item.custom_food_id ?? item.standard_food_id,
        isCustom: item.custom_food_id != null,
        name: item.food_name_snapshot,
        translationKey: item.standard_food_id
          ? (standardFoods[item.standard_food_id]?.translationKey ?? null)
          : null,
        amount: numberOrNull(item.quantity_value),
        unit: item.quantity_unit,
        sortOrder: item.sort_order,
      });
    }
  }

  const vaccineIds = activeRows
    .filter((row) => row.entry_type === "vaccine")
    .map((row) => row.id);

  if (vaccineIds.length > 0) {
    const result = await database.query(
      `
        SELECT
          r.id,
          r.source_tracking_entry_id,
          r.status,
          to_char(r.due_date, 'YYYY-MM-DD') AS next_dose_date
        FROM vaccination_reminders r
        INNER JOIN tracking_entries t
          ON t.id = r.source_tracking_entry_id
        WHERE t.child_id = $1
          AND t.id = ANY($2::uuid[])
      `,
      [childId, vaccineIds],
    );

    for (const reminder of result.rows) {
      const entryId = reminder.source_tracking_entry_id;

      if (remindersById.has(entryId)) {
        throw createTrackingError(
          "AMBIGUOUS_VACCINATION_REMINDER",
          "Multiple reminders reference the same vaccination.",
          500,
        );
      }

      remindersById.set(entryId, reminder);
    }
  }

  if (activeIds.length > 0) {
    const result = await database.query(
      `
        SELECT
          a.*,
          link.tracking_entry_id,
          link.sort_order
        FROM tracking_entry_attachments link
        INNER JOIN attachments a
          ON a.id = link.attachment_id
        INNER JOIN tracking_entries t
          ON t.id = link.tracking_entry_id
        WHERE t.child_id = $1
          AND t.id = ANY($2::uuid[])
          AND a.deleted_at IS NULL
        ORDER BY link.sort_order ASC, a.id ASC
      `,
      [childId, activeIds],
    );

    for (const photo of result.rows) {
      const entryId = photo.tracking_entry_id;

      if (!photoRowsById.has(entryId)) {
        photoRowsById.set(entryId, []);
      }

      photoRowsById.get(entryId).push(photo);
    }
  }

  return rows.map((row) => {
    const entry = mapBaseEntry(row);

    // Prévu pour la future récupération des suppressions.
    if (entry.deletedAt) {
      return {
        ...entry,
        photos: [],
      };
    }

    const details = detailsById.get(entry.id);

    if (entry.type !== "note" && !details) {
      throw createTrackingError(
        "TRACKING_DETAILS_MISSING",
        "Tracking entry details are missing.",
        500,
      );
    }

    if (
      ["diaper", "potty"].includes(entry.type) &&
      details.toileting_method !== entry.type
    ) {
      throw createTrackingError(
        "TRACKING_DETAILS_MISMATCH",
        "Tracking entry details do not match its type.",
        500,
      );
    }

    return {
      ...entry,
      ...mapDetails(
        entry,
        details,
        foodsById.get(entry.id) ?? [],
        remindersById.get(entry.id),
      ),
      photos: [],
      photoRows: photoRowsById.get(entry.id) ?? [],
    };
  });
}

/*
 * Signature des liens après la transaction SQL.
 * Les clés internes de stockage ne sont jamais renvoyées au client.
 */
async function signTrackingPagePhotos(entries) {
  const result = [];

  for (const entry of entries) {
    const { photoRows = [], ...publicEntry } = entry;

    const photos = await Promise.all(
      photoRows.map(async (photo) => ({
        id: photo.id,
        attachmentId: photo.id,
        mimeType: photo.mime_type,
        sizeBytes: Number(photo.size_bytes),
        width: photo.width,
        height: photo.height,
        sortOrder: photo.sort_order,
        createdAt: toIso(photo.created_at),
        url: await createSignedDownloadUrl({
          storageKey: photo.storage_key,
        }),
        cacheKey: `tracking-photo:${photo.id}`,
      })),
    );

    result.push({
      ...publicEntry,
      photos,
    });
  }

  return result;
}

module.exports = {
  readTrackingPage,
  signTrackingPagePhotos,
};
