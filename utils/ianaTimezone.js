function normalizeIanaTimezone(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 100 ||
    value !== value.trim()
  ) {
    return null;
  }

  if (/^[+-]\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  try {
    const formatter = new Intl.DateTimeFormat("en", {
      timeZone: value,
    });

    const timezone = formatter.resolvedOptions().timeZone;

    if (typeof timezone !== "string" || !timezone || timezone.length > 100) {
      return null;
    }

    return timezone;
  } catch {
    return null;
  }
}

module.exports = {
  normalizeIanaTimezone,
};
