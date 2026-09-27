function createEmailChangeCodeEmail({ code, locale }) {
  const isFrench = String(locale || "")
    .toLowerCase()
    .startsWith("fr");

  const subject = isFrench
    ? `${code} — Confirmez votre nouvelle adresse e-mail Nelo`
    : `${code} — Confirm your new Nelo email address`;

  const instruction = isFrench
    ? "Utilisez ce code pour confirmer votre nouvelle adresse e-mail :"
    : "Use this code to confirm your new email address:";

  const expiration = isFrench
    ? "Ce code expire dans 10 minutes."
    : "This code expires in 10 minutes.";

  const text = `${instruction}\n\n${code}\n\n${expiration}`;

  return {
    subject,
    text,
    html: `
      <!doctype html>
      <html lang="${isFrench ? "fr" : "en"}">
        <body style="font-family:Arial,sans-serif;color:#26324a;padding:32px">
          <h1>Nelo</h1>
          <p>${instruction}</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:6px">
            ${code}
          </p>
          <p>${expiration}</p>
        </body>
      </html>
    `,
  };
}

module.exports = { createEmailChangeCodeEmail };
