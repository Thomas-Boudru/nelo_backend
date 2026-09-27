const SUPPORTED_LOCALES = ["en", "fr", "de", "es", "it", "nl", "pt"];

const translations = {
  en: {
    title: "Confirm your new Nelo email address",
    instruction: "Use this code to confirm your new email address:",
    expiration: "This code expires in 10 minutes.",
    ignore:
      "If you did not request this change, you can ignore this email. Your current email address will remain unchanged.",
  },

  fr: {
    title: "Confirmez votre nouvelle adresse e-mail Nelo",
    instruction:
      "Utilisez ce code pour confirmer votre nouvelle adresse e-mail :",
    expiration: "Ce code expire dans 10 minutes.",
    ignore:
      "Si vous n’avez pas demandé ce changement, vous pouvez ignorer cet e-mail. Votre adresse actuelle restera inchangée.",
  },

  de: {
    title: "Bestätige deine neue Nelo-E-Mail-Adresse",
    instruction:
      "Verwende diesen Code, um deine neue E-Mail-Adresse zu bestätigen:",
    expiration: "Dieser Code läuft in 10 Minuten ab.",
    ignore:
      "Wenn du diese Änderung nicht angefordert hast, kannst du diese E-Mail ignorieren. Deine bisherige E-Mail-Adresse bleibt unverändert.",
  },

  es: {
    title: "Confirma tu nueva dirección de correo de Nelo",
    instruction: "Usa este código para confirmar tu nueva dirección de correo:",
    expiration: "Este código caduca en 10 minutos.",
    ignore:
      "Si no solicitaste este cambio, puedes ignorar este correo. Tu dirección de correo actual no cambiará.",
  },

  it: {
    title: "Conferma il tuo nuovo indirizzo e-mail Nelo",
    instruction:
      "Usa questo codice per confermare il tuo nuovo indirizzo e-mail:",
    expiration: "Questo codice scade tra 10 minuti.",
    ignore:
      "Se non hai richiesto questa modifica, puoi ignorare questa e-mail. Il tuo indirizzo attuale resterà invariato.",
  },

  nl: {
    title: "Bevestig je nieuwe e-mailadres voor Nelo",
    instruction: "Gebruik deze code om je nieuwe e-mailadres te bevestigen:",
    expiration: "Deze code verloopt over 10 minuten.",
    ignore:
      "Als je deze wijziging niet hebt aangevraagd, kun je deze e-mail negeren. Je huidige e-mailadres blijft ongewijzigd.",
  },

  pt: {
    title: "Confirma o teu novo endereço de e-mail do Nelo",
    instruction:
      "Utiliza este código para confirmar o teu novo endereço de e-mail:",
    expiration: "Este código expira dentro de 10 minutos.",
    ignore:
      "Se não pediste esta alteração, podes ignorar este e-mail. O teu endereço de e-mail atual não será alterado.",
  },
};

function normalizeLocale(locale) {
  const normalizedLocale = String(locale || "en")
    .trim()
    .toLowerCase()
    .split("-")[0];

  return SUPPORTED_LOCALES.includes(normalizedLocale) ? normalizedLocale : "en";
}

function createEmailChangeCodeEmail({ code, locale }) {
  const normalizedLocale = normalizeLocale(locale);
  const content = translations[normalizedLocale];

  // Le code reste visible dans la notification de l'e-mail.
  const subject = `${code} — ${content.title}`;
  const previewText = `${code} · ${content.expiration}`;

  const text = [
    `${code} — ${content.title}`,
    "",
    content.instruction,
    "",
    code,
    "",
    content.expiration,
    "",
    content.ignore,
  ].join("\n");

  const html = `
    <!doctype html>
    <html lang="${normalizedLocale}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${subject}</title>
      </head>

      <body style="margin:0;background:#edf1fa;font-family:Arial,sans-serif;color:#26324a;">
        <div
          style="
            display:none;
            max-height:0;
            overflow:hidden;
            opacity:0;
            color:transparent;
          "
        >
          ${previewText}
        </div>

        <div style="padding:32px 16px;">
          <div
            style="
              max-width:520px;
              margin:0 auto;
              padding:36px 28px;
              border-radius:24px;
              background:#ffffff;
              text-align:center;
            "
          >
            <div
              style="
                font-size:28px;
                font-weight:700;
                color:#5d8ff7;
              "
            >
              Nelo
            </div>

            <div
              style="
                margin:24px auto 20px;
                padding:18px 20px;
                border-radius:16px;
                background:#f1f5ff;
                color:#26324a;
                font-size:34px;
                font-weight:700;
                letter-spacing:8px;
              "
            >
              ${code}
            </div>

            <h1
              style="
                margin:0 0 12px;
                font-size:24px;
                line-height:32px;
              "
            >
              ${content.title}
            </h1>

            <p
              style="
                margin:0;
                color:#65708a;
                font-size:16px;
                line-height:24px;
              "
            >
              ${content.instruction}
            </p>

            <p
              style="
                margin:24px 0 0;
                color:#65708a;
                font-size:14px;
                line-height:22px;
              "
            >
              ${content.expiration}
            </p>

            <p
              style="
                margin:20px 0 0;
                color:#8a93a8;
                font-size:12px;
                line-height:19px;
              "
            >
              ${content.ignore}
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    subject,
    text,
    html,
  };
}

module.exports = {
  createEmailChangeCodeEmail,
};
