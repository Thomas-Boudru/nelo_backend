const SUPPORTED_LOCALES = ["en", "fr", "de", "es", "it", "nl", "pt"];

const translations = {
  en: {
    "Your Nelo verification code": "Your Nelo verification code",
    "Use this code to sign in to Nelo:": "Use this code to sign in to Nelo:",
    "This code expires in 10 minutes.": "This code expires in 10 minutes.",
    "If you did not request this code, you can ignore this email.":
      "If you did not request this code, you can ignore this email.",
  },

  fr: {
    "Your Nelo verification code": "Votre code de vérification Nelo",
    "Use this code to sign in to Nelo:":
      "Utilisez ce code pour vous connecter à Nelo :",
    "This code expires in 10 minutes.": "Ce code expire dans 10 minutes.",
    "If you did not request this code, you can ignore this email.":
      "Si vous n’avez pas demandé ce code, vous pouvez ignorer cet e-mail.",
  },

  de: {
    "Your Nelo verification code": "Dein Nelo-Bestätigungscode",
    "Use this code to sign in to Nelo:":
      "Verwende diesen Code, um dich bei Nelo anzumelden:",
    "This code expires in 10 minutes.": "Dieser Code läuft in 10 Minuten ab.",
    "If you did not request this code, you can ignore this email.":
      "Wenn du diesen Code nicht angefordert hast, kannst du diese E-Mail ignorieren.",
  },

  es: {
    "Your Nelo verification code": "Tu código de verificación de Nelo",
    "Use this code to sign in to Nelo:":
      "Usa este código para iniciar sesión en Nelo:",
    "This code expires in 10 minutes.": "Este código caduca en 10 minutos.",
    "If you did not request this code, you can ignore this email.":
      "Si no solicitaste este código, puedes ignorar este correo.",
  },

  it: {
    "Your Nelo verification code": "Il tuo codice di verifica Nelo",
    "Use this code to sign in to Nelo:":
      "Usa questo codice per accedere a Nelo:",
    "This code expires in 10 minutes.": "Questo codice scade tra 10 minuti.",
    "If you did not request this code, you can ignore this email.":
      "Se non hai richiesto questo codice, puoi ignorare questa e-mail.",
  },

  nl: {
    "Your Nelo verification code": "Je Nelo-verificatiecode",
    "Use this code to sign in to Nelo:":
      "Gebruik deze code om in te loggen bij Nelo:",
    "This code expires in 10 minutes.": "Deze code verloopt over 10 minuten.",
    "If you did not request this code, you can ignore this email.":
      "Als je deze code niet hebt aangevraagd, kun je deze e-mail negeren.",
  },

  pt: {
    "Your Nelo verification code": "O teu código de verificação Nelo",
    "Use this code to sign in to Nelo:":
      "Utiliza este código para iniciar sessão no Nelo:",
    "This code expires in 10 minutes.":
      "Este código expira dentro de 10 minutos.",
    "If you did not request this code, you can ignore this email.":
      "Se não pediste este código, podes ignorar este e-mail.",
  },
};

function normalizeLocale(locale) {
  const normalizedLocale = String(locale || "en")
    .toLowerCase()
    .split("-")[0];

  return SUPPORTED_LOCALES.includes(normalizedLocale) ? normalizedLocale : "en";
}

function createLoginCodeEmail({ code, locale }) {
  const normalizedLocale = normalizeLocale(locale);
  const content = translations[normalizedLocale];

  const translatedSubject = content["Your Nelo verification code"];

  // Le code apparaît directement dans la notification de l’e-mail.
  const subject = `${code} — ${translatedSubject}`;

  const previewText = `${code} · ${
    content["This code expires in 10 minutes."]
  }`;

  // Le code est également placé au début de la version texte.
  const text = [
    `${code} — ${translatedSubject}`,
    "",
    content["Use this code to sign in to Nelo:"],
    "",
    code,
    "",
    content["This code expires in 10 minutes."],
    content["If you did not request this code, you can ignore this email."],
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
              background:#ffffff;
              border-radius:24px;
              padding:36px 28px;
              text-align:center;
            "
          >
            <div style="font-size:28px;font-weight:700;color:#5d8ff7;">
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

            <h1 style="margin:0 0 12px;font-size:24px;line-height:32px;">
              ${translatedSubject}
            </h1>

            <p style="margin:0;color:#65708a;font-size:16px;line-height:24px;">
              ${content["Use this code to sign in to Nelo:"]}
            </p>

            <p style="margin:24px 0 0;color:#65708a;font-size:14px;line-height:22px;">
              ${content["This code expires in 10 minutes."]}
            </p>

            <p style="margin:20px 0 0;color:#8a93a8;font-size:12px;line-height:19px;">
              ${
                content[
                  "If you did not request this code, you can ignore this email."
                ]
              }
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
  createLoginCodeEmail,
};
