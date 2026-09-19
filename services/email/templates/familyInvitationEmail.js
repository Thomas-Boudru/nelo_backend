const SUPPORTED_LOCALES = ["en", "fr", "de", "es", "it", "nl", "pt"];

const translations = {
  en: {
    "You have been invited to Nelo": "You have been invited to Nelo",
    "invited you to join the profile of": "invited you to join the profile of",
    "Accept invitation": "Accept invitation",
    "This invitation expires in 7 days.": "This invitation expires in 7 days.",
    "This invitation is intended only for this email address.":
      "This invitation is intended only for this email address.",
    "If you were not expecting this invitation, you can ignore this email.":
      "If you were not expecting this invitation, you can ignore this email.",
  },

  fr: {
    "You have been invited to Nelo": "Vous avez été invité sur Nelo",
    "invited you to join the profile of":
      "vous invite à rejoindre le profil de",
    "Accept invitation": "Accepter l’invitation",
    "This invitation expires in 7 days.":
      "Cette invitation expire dans 7 jours.",
    "This invitation is intended only for this email address.":
      "Cette invitation est uniquement destinée à cette adresse e-mail.",
    "If you were not expecting this invitation, you can ignore this email.":
      "Si vous n’attendiez pas cette invitation, vous pouvez ignorer cet e-mail.",
  },

  de: {
    "You have been invited to Nelo": "Du wurdest zu Nelo eingeladen",
    "invited you to join the profile of": "hat dich eingeladen, dem Profil von",
    "Accept invitation": "Einladung annehmen",
    "This invitation expires in 7 days.":
      "Diese Einladung läuft in 7 Tagen ab.",
    "This invitation is intended only for this email address.":
      "Diese Einladung ist nur für diese E-Mail-Adresse bestimmt.",
    "If you were not expecting this invitation, you can ignore this email.":
      "Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.",
  },

  es: {
    "You have been invited to Nelo": "Te han invitado a Nelo",
    "invited you to join the profile of":
      "te ha invitado a unirte al perfil de",
    "Accept invitation": "Aceptar la invitación",
    "This invitation expires in 7 days.": "Esta invitación caduca en 7 días.",
    "This invitation is intended only for this email address.":
      "Esta invitación está destinada únicamente a esta dirección de correo.",
    "If you were not expecting this invitation, you can ignore this email.":
      "Si no esperabas esta invitación, puedes ignorar este correo.",
  },

  it: {
    "You have been invited to Nelo": "Sei stato invitato su Nelo",
    "invited you to join the profile of":
      "ti ha invitato a unirti al profilo di",
    "Accept invitation": "Accetta l’invito",
    "This invitation expires in 7 days.": "Questo invito scade tra 7 giorni.",
    "This invitation is intended only for this email address.":
      "Questo invito è destinato esclusivamente a questo indirizzo e-mail.",
    "If you were not expecting this invitation, you can ignore this email.":
      "Se non aspettavi questo invito, puoi ignorare questa e-mail.",
  },

  nl: {
    "You have been invited to Nelo": "Je bent uitgenodigd voor Nelo",
    "invited you to join the profile of":
      "heeft je uitgenodigd voor het profiel van",
    "Accept invitation": "Uitnodiging accepteren",
    "This invitation expires in 7 days.":
      "Deze uitnodiging verloopt over 7 dagen.",
    "This invitation is intended only for this email address.":
      "Deze uitnodiging is uitsluitend bestemd voor dit e-mailadres.",
    "If you were not expecting this invitation, you can ignore this email.":
      "Als je deze uitnodiging niet verwachtte, kun je deze e-mail negeren.",
  },

  pt: {
    "You have been invited to Nelo": "Recebeste um convite para o Nelo",
    "invited you to join the profile of":
      "convidou-te para aceder ao perfil de",
    "Accept invitation": "Aceitar convite",
    "This invitation expires in 7 days.":
      "Este convite expira dentro de 7 dias.",
    "This invitation is intended only for this email address.":
      "Este convite destina-se exclusivamente a este endereço de e-mail.",
    "If you were not expecting this invitation, you can ignore this email.":
      "Se não estavas à espera deste convite, podes ignorar este e-mail.",
  },
};

function normalizeLocale(locale) {
  const normalizedLocale = String(locale || "en")
    .toLowerCase()
    .split("-")[0];

  return SUPPORTED_LOCALES.includes(normalizedLocale) ? normalizedLocale : "en";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createFamilyInvitationEmail({
  inviterName,
  childName,
  inviteUrl,
  locale,
}) {
  const normalizedLocale = normalizeLocale(locale);
  const content = translations[normalizedLocale];

  const safeInviterName = escapeHtml(inviterName);
  const safeChildName = escapeHtml(childName);
  const safeInviteUrl = escapeHtml(inviteUrl);

  const subject = `${content["You have been invited to Nelo"]} — ${childName}`;

  const invitationSentence =
    `${inviterName} ` +
    `${content["invited you to join the profile of"]} ` +
    `${childName}.`;

  const previewText = invitationSentence;

  const text = [
    content["You have been invited to Nelo"],
    "",
    invitationSentence,
    "",
    content["Accept invitation"],
    inviteUrl,
    "",
    content["This invitation expires in 7 days."],
    content["This invitation is intended only for this email address."],
    "",
    content[
      "If you were not expecting this invitation, you can ignore this email."
    ],
  ].join("\n");

  const html = `
    <!doctype html>
    <html lang="${normalizedLocale}">
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
        <title>${escapeHtml(subject)}</title>
      </head>

      <body
        style="
          margin:0;
          background:#edf1fa;
          font-family:Arial,sans-serif;
          color:#26324a;
        "
      >
        <div
          style="
            display:none;
            max-height:0;
            overflow:hidden;
            opacity:0;
            color:transparent;
          "
        >
          ${escapeHtml(previewText)}
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
                width:64px;
                height:64px;
                margin:24px auto 18px;
                border-radius:32px;
                background:#f1f5ff;
                line-height:64px;
                font-size:28px;
              "
            >
              👶
            </div>

            <h1
              style="
                margin:0;
                font-size:24px;
                line-height:32px;
              "
            >
              ${content["You have been invited to Nelo"]}
            </h1>

            <p
              style="
                margin:16px 0 0;
                color:#65708a;
                font-size:16px;
                line-height:25px;
              "
            >
              <strong style="color:#26324a;">
                ${safeInviterName}
              </strong>

              ${content["invited you to join the profile of"]}

              <strong style="color:#26324a;">
                ${safeChildName}
              </strong>.
            </p>

            <a
              href="${safeInviteUrl}"
              style="
                display:inline-block;
                margin-top:26px;
                padding:14px 24px;
                border-radius:14px;
                background:#5d8ff7;
                color:#ffffff;
                font-size:15px;
                font-weight:700;
                text-decoration:none;
              "
            >
              ${content["Accept invitation"]}
            </a>

            <p
              style="
                margin:24px 0 0;
                color:#65708a;
                font-size:13px;
                line-height:21px;
              "
            >
              ${content["This invitation expires in 7 days."]}
            </p>

            <p
              style="
                margin:8px 0 0;
                color:#65708a;
                font-size:13px;
                line-height:21px;
              "
            >
              ${
                content[
                  "This invitation is intended only for this email address."
                ]
              }
            </p>

            <p
              style="
                margin:22px 0 0;
                color:#8a93a8;
                font-size:12px;
                line-height:19px;
              "
            >
              ${
                content[
                  "If you were not expecting this invitation, you can ignore this email."
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
  createFamilyInvitationEmail,
};
