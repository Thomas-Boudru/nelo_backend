const customFoodService = require("../../../services/tracking/feed/customFoodService");

async function listCustomFoods(req, res, next) {
  try {
    const foods = await customFoodService.listCustomFoods({
      childId: req.params.childId,
      userId: req.auth.userId,
    });

    return res.status(200).json({ foods });
  } catch (error) {
    return next(error);
  }
}

async function createCustomFood(req, res, next) {
  try {
    const result = await customFoodService.createCustomFood({
      childId: req.params.childId,
      userId: req.auth.userId,
      data: req.body,
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateCustomFood(req, res, next) {
  try {
    const food = await customFoodService.updateCustomFood({
      childId: req.params.childId,
      userId: req.auth.userId,
      foodId: req.params.foodId,
      data: req.body,
    });

    return res.status(200).json({ food });
  } catch (error) {
    return next(error);
  }
}

async function deleteCustomFood(req, res, next) {
  try {
    const result = await customFoodService.deleteCustomFood({
      childId: req.params.childId,
      userId: req.auth.userId,
      foodId: req.params.foodId,
      version: req.body?.version,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listCustomFoods,
  createCustomFood,
  updateCustomFood,
  deleteCustomFood,
};
