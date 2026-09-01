exports.up = (pgm) => {
  /*
   * Un utilisateur ne peut posséder qu’une seule famille active.
   * Il peut rester contributor dans plusieurs autres familles.
   */
  pgm.createIndex("family_members", "user_id", {
    name: "family_members_user_unique_active_owner_idx",
    unique: true,
    where: "removed_at IS NULL AND family_role = 'owner'",
  });

  /*
   * Le nom d’un enfant attendu est optionnel.
   */
  pgm.alterColumn("children", "display_name", {
    type: "varchar(100)",
    notNull: false,
  });

  /*
   * Les nouveaux enfants utilisent le thème blue par défaut.
   * Cette modification ne change pas le thème des enfants existants.
   */
  pgm.alterColumn("children", "default_theme_mode", {
    type: "varchar(20)",
    notNull: true,
    default: "blue",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("family_members", "user_id", {
    name: "family_members_user_unique_active_owner_idx",
  });

  /*
   * Une valeur est nécessaire avant de pouvoir restaurer NOT NULL.
   * Cette partie ne sera utilisée qu’en cas de rollback.
   */
  pgm.sql(`
    UPDATE children
    SET display_name = 'Baby'
    WHERE display_name IS NULL
  `);

  pgm.alterColumn("children", "display_name", {
    type: "varchar(100)",
    notNull: true,
  });

  pgm.alterColumn("children", "default_theme_mode", {
    type: "varchar(20)",
    notNull: true,
    default: "light",
  });
};
