const customProductsService = require("../../../services/tracking/medication/customProductsService");

function createListController(type) {
  return async function listCustomProducts(req, res, next) {
    try {
      const products = await customProductsService.getCustomProducts({
        childId: req.params.childId,
        userId: req.auth.userId,
        type,
      });

      return res.status(200).json({ products });
    } catch (error) {
      return next(error);
    }
  };
}

function createPostController(type) {
  return async function postCustomProduct(req, res, next) {
    try {
      const result = await customProductsService.createCustomProduct({
        childId: req.params.childId,
        userId: req.auth.userId,
        type,
        data: req.body,
      });

      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

function createUpdateController(type) {
  return async function updateCustomProduct(req, res, next) {
    try {
      const product = await customProductsService.updateCustomProduct({
        childId: req.params.childId,
        userId: req.auth.userId,
        type,
        productId: req.params.productId,
        data: req.body,
      });

      return res.status(200).json({ product });
    } catch (error) {
      return next(error);
    }
  };
}

function createArchiveController(type) {
  return async function archiveCustomProduct(req, res, next) {
    try {
      const product = await customProductsService.archiveCustomProduct({
        childId: req.params.childId,
        userId: req.auth.userId,
        type,
        productId: req.params.productId,
        version: req.body?.version,
      });

      return res.status(200).json({
        archived: true,
        product,
      });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  getCustomMedications: createListController("medication"),
  createCustomMedication: createPostController("medication"),
  updateCustomMedication: createUpdateController("medication"),
  archiveCustomMedication: createArchiveController("medication"),

  getCustomVaccines: createListController("vaccine"),
  createCustomVaccine: createPostController("vaccine"),
  updateCustomVaccine: createUpdateController("vaccine"),
  archiveCustomVaccine: createArchiveController("vaccine"),
};
