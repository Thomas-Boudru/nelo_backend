const { Resend } = require("resend");

const { createLoginCodeEmail } = require("./templates/loginCodeEmail");

const {
  createEmailChangeCodeEmail,
} = require("./templates/emailChangeCodeEmail");

const {
  createFamilyInvitationEmail,
} = require("./templates/familyInvitationEmail");

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY environment variable.");
  }

  return new Resend(process.env.RESEND_API_KEY);
}

async function sendLoginCodeEmail({ email, code, locale }) {
  if (process.env.EMAIL_DELIVERY_MODE === "log") {
    console.log(`Development login code for ${email}: ${code}`);

    return;
  }

  if (!process.env.AUTH_EMAIL_FROM) {
    throw new Error("Missing AUTH_EMAIL_FROM environment variable.");
  }

  const emailContent = createLoginCodeEmail({
    code,
    locale,
  });

  const resend = getResendClient();

  const { data, error } = await resend.emails.send({
    from: process.env.AUTH_EMAIL_FROM,
    to: [email],
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  if (error) {
    const resendError = new Error("Unable to send the login email.");

    resendError.code = "EMAIL_DELIVERY_FAILED";
    resendError.details = error;

    throw resendError;
  }

  return data;
}

async function sendFamilyInvitationEmail({
  email,
  inviterName,
  childName,
  inviteUrl,
  locale,
}) {
  const emailContent = createFamilyInvitationEmail({
    inviterName,
    childName,
    inviteUrl,
    locale,
  });

  /*
   * En développement, on n'envoie pas réellement l'email.
   * Le lien complet est affiché dans le terminal.
   */
  if (process.env.EMAIL_DELIVERY_MODE === "log") {
    console.log(`Development family invitation for ${email}: ${inviteUrl}`);

    return;
  }

  if (!process.env.AUTH_EMAIL_FROM) {
    throw new Error("Missing AUTH_EMAIL_FROM environment variable.");
  }

  const resend = getResendClient();

  const { data, error } = await resend.emails.send({
    from: process.env.AUTH_EMAIL_FROM,
    to: [email],
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  if (error) {
    const resendError = new Error(
      "Unable to send the family invitation email.",
    );

    resendError.code = "FAMILY_INVITATION_EMAIL_DELIVERY_FAILED";

    resendError.details = error;

    throw resendError;
  }

  return data;
}

async function sendEmailChangeCodeEmail({ email, code, locale }) {
  if (process.env.EMAIL_DELIVERY_MODE === "log") {
    console.log(`Development email change code for ${email}: ${code}`);
    return;
  }

  if (!process.env.AUTH_EMAIL_FROM) {
    throw new Error("Missing AUTH_EMAIL_FROM environment variable.");
  }

  const content = createEmailChangeCodeEmail({ code, locale });
  const resend = getResendClient();

  const { data, error } = await resend.emails.send({
    from: process.env.AUTH_EMAIL_FROM,
    to: [email],
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (error) {
    const deliveryError = new Error("Unable to send the email change code.");
    deliveryError.code = "EMAIL_DELIVERY_FAILED";
    deliveryError.details = error;
    throw deliveryError;
  }

  return data;
}

module.exports = {
  sendFamilyInvitationEmail,
  sendLoginCodeEmail,
  sendEmailChangeCodeEmail,
};
