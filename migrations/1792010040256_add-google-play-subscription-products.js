exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO subscription_products (
      id,
      plan_code,
      store,
      store_product_id,
      store_base_plan_id,
      billing_period,
      revenuecat_product_id,
      is_available_for_purchase
    )
    VALUES
      (
        gen_random_uuid(),
        'premium',
        'play_store',
        'nelo.premium',
        'monthly',
        'month',
        'prod74f540dc5f',
        TRUE
      ),
      (
        gen_random_uuid(),
        'premium',
        'play_store',
        'nelo.premium',
        'yearly',
        'year',
        'prod39c2963694',
        TRUE
      );
  `);
};

exports.down = (pgm) => {
  // Conserver les produits pour préserver les références
  // des abonnements et intentions d'achat existants.
  pgm.sql(`
    UPDATE subscription_products
    SET
      is_available_for_purchase = FALSE,
      updated_at = NOW()
    WHERE store = 'play_store'
      AND store_product_id = 'nelo.premium'
      AND (
        (
          store_base_plan_id = 'monthly'
          AND revenuecat_product_id = 'prod74f540dc5f'
        )
        OR
        (
          store_base_plan_id = 'yearly'
          AND revenuecat_product_id = 'prod39c2963694'
        )
      );
  `);
};
