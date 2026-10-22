const express = require("express");

const authenticate = require("../../middleware/authenticate");

const {
  getDailyReportSettings,
  saveDailyReportSettings,
  getDailyReport,
} = require("../../services/dailyReports/dailyReportService");

const router = express.Router();

router.use(authenticate);

// Les réponses contiennent des informations familiales.
// Évite leur mise en cache par un intermédiaire HTTP.
router.use((req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

router.get("/:familyId/daily-report-settings", async (req, res, next) => {
  try {
    const result = await getDailyReportSettings({
      familyId: req.params.familyId,
      userId: req.auth.userId,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/:familyId/daily-report-settings", async (req, res, next) => {
  try {
    const result = await saveDailyReportSettings({
      familyId: req.params.familyId,
      userId: req.auth.userId,
      data: req.body,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get(
  "/:familyId/children/:childId/daily-reports/:reportDate",
  async (req, res, next) => {
    try {
      const result = await getDailyReport({
        familyId: req.params.familyId,
        childId: req.params.childId,
        userId: req.auth.userId,
        reportDate: req.params.reportDate,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
