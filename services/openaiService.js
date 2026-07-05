const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function analyzeDocumentImage({ buffer, mimeType }) {
  const base64Image = buffer.toString("base64");

  const response = await openai.responses.create({
    model: "gpt-5.4-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
Analyse cette image de document administratif ou facture.
Retourne uniquement les informations visibles.
Si une information est absente, mets null.
            `,
          },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${base64Image}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "document_extraction",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            documentType: { type: ["string", "null"] },
            issuerName: { type: ["string", "null"] },
            invoiceNumber: { type: ["string", "null"] },
            date: { type: ["string", "null"] },
            dueDate: { type: ["string", "null"] },
            totalAmount: { type: ["number", "null"] },
            currency: { type: ["string", "null"] },
            iban: { type: ["string", "null"] },
            communication: { type: ["string", "null"] },
            summary: { type: ["string", "null"] },
          },
          required: [
            "documentType",
            "issuerName",
            "invoiceNumber",
            "date",
            "dueDate",
            "totalAmount",
            "currency",
            "iban",
            "communication",
            "summary",
          ],
        },
      },
    },
  });

  return JSON.parse(response.output_text);
}

module.exports = { analyzeDocumentImage };
