const { z } = require("zod");

const onboardingService = require("../../services/onboarding/onboardingService");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

const nullableDateSchema = z
  .string()
  .regex(DATE_PATTERN, "The date must use the YYYY-MM-DD format.")
  .nullable();

const onboardingSchema = z
  .object({
    user: z.object({
      displayName: z
        .string()
        .trim()
        .min(2, "The display name must contain at least 2 characters.")
        .max(40, "The display name must contain at most 40 characters."),
    }),

    child: z.object({
      status: z.enum(["born", "expected"]),

      displayName: z
        .string()
        .trim()
        .max(100, "The child name must contain at most 100 characters.")
        .nullable(),

      gender: z.enum(["female", "male", "intersex", "unspecified"]).nullable(),

      birthDate: nullableDateSchema,

      birthTime: z
        .string()
        .regex(TIME_PATTERN, "The birth time must use the HH:mm format.")
        .nullable(),

      expectedBirthDate: nullableDateSchema,

      isPremature: z.boolean(),

      gestationalAgeWeeks: z.number().int().min(20).max(36).nullable(),

      gestationalAgeDays: z.number().int().min(0).max(6).nullable(),
    }),

    membership: z.object({
      relationship: z.enum([
        "mother",
        "father",
        "parent",
        "grandparent",
        "family_or_friend",
        "caregiver",
        "other",
      ]),
    }),

    preferences: z.object({
      themeMode: z.string().trim().min(1).max(20),
    }),
  })
  .strict()
  .superRefine((data, context) => {
    const { child } = data;

    if (child.status === "born") {
      if (!child.displayName) {
        context.addIssue({
          code: "custom",
          path: ["child", "displayName"],
          message: "A born child must have a display name.",
        });
      }

      if (!child.birthDate) {
        context.addIssue({
          code: "custom",
          path: ["child", "birthDate"],
          message: "A born child must have a birth date.",
        });
      }

      if (child.expectedBirthDate !== null) {
        context.addIssue({
          code: "custom",
          path: ["child", "expectedBirthDate"],
          message: "A born child cannot have an expected birth date.",
        });
      }

      if (child.isPremature && child.gestationalAgeWeeks === null) {
        context.addIssue({
          code: "custom",
          path: ["child", "gestationalAgeWeeks"],
          message: "Gestational age is required for a premature child.",
        });
      }

      if (
        !child.isPremature &&
        (child.gestationalAgeWeeks !== null ||
          child.gestationalAgeDays !== null)
      ) {
        context.addIssue({
          code: "custom",
          path: ["child", "gestationalAgeWeeks"],
          message:
            "Gestational age must be empty when the child is not premature.",
        });
      }
    }

    if (child.status === "expected") {
      if (!child.expectedBirthDate) {
        context.addIssue({
          code: "custom",
          path: ["child", "expectedBirthDate"],
          message: "An expected child must have an expected birth date.",
        });
      }

      if (child.birthDate !== null || child.birthTime !== null) {
        context.addIssue({
          code: "custom",
          path: ["child", "birthDate"],
          message: "An expected child cannot have birth information.",
        });
      }

      if (
        child.isPremature ||
        child.gestationalAgeWeeks !== null ||
        child.gestationalAgeDays !== null
      ) {
        context.addIssue({
          code: "custom",
          path: ["child", "isPremature"],
          message: "Prematurity information is only available after birth.",
        });
      }
    }
  });

async function completeOnboarding(req, res, next) {
  try {
    const validation = onboardingSchema.safeParse(req.body);

    if (!validation.success) {
      const firstIssue = validation.error.issues[0];

      return res.status(400).json({
        error: {
          code: "INVALID_ONBOARDING_DATA",
          message: firstIssue.message,
          field: firstIssue.path.join("."),
        },
      });
    }

    const result = await onboardingService.completeOnboarding({
      userId: req.auth.userId,
      data: validation.data,
    });

    return res.status(result.alreadyCompleted ? 200 : 201).json({
      onboarding: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  completeOnboarding,
};
