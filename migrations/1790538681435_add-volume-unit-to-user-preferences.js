exports.up = (pgm) => {
  pgm.addColumn("user_preferences", {
    volume_unit: {
      type: "varchar(10)",
      notNull: true,
      default: "ml",
    },
  });

  pgm.addConstraint("user_preferences", "user_preferences_volume_unit_check", {
    check: "volume_unit IN ('ml', 'fl_oz')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("user_preferences", "user_preferences_volume_unit_check");

  pgm.dropColumn("user_preferences", "volume_unit");
};
