exports.up = (pgm) => {
  pgm.sql(`
    UPDATE subscription_products
    SET revenuecat_product_id = 'prod493bc14e49'
    WHERE store = 'app_store'
      AND store_product_id = 'nelo.premium.monthly'
      AND store_base_plan_id = '';

    UPDATE subscription_products
    SET revenuecat_product_id = 'prodb37faa1603'
    WHERE store = 'app_store'
      AND store_product_id = 'nelo.premium.yearly'
      AND store_base_plan_id = '';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE subscription_products
    SET revenuecat_product_id = NULL
    WHERE store = 'app_store'
      AND store_base_plan_id = ''
      AND (
        (
          store_product_id = 'nelo.premium.monthly'
          AND revenuecat_product_id = 'prod493bc14e49'
        )
        OR
        (
          store_product_id = 'nelo.premium.yearly'
          AND revenuecat_product_id = 'prodb37faa1603'
        )
      );
  `);
};
