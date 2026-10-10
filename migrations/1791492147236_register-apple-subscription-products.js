exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO subscription_products (
      plan_code,
      store,
      store_product_id,
      store_base_plan_id,
      billing_period,
      is_available_for_purchase
    )
    VALUES
      (
        'premium',
        'app_store',
        'nelo.premium.monthly',
        '',
        'month',
        FALSE
      ),
      (
        'premium',
        'app_store',
        'nelo.premium.yearly',
        '',
        'year',
        FALSE
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM subscription_products
    WHERE store = 'app_store'
      AND store_base_plan_id = ''
      AND store_product_id IN (
        'nelo.premium.monthly',
        'nelo.premium.yearly'
      );
  `);
};
