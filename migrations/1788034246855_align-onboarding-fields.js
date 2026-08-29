exports.up = (pgm) => {
  // Le prénom peut être absent pour un enfant qui n’est pas encore né.
  pgm.alterColumn("children", "display_name", {
    notNull: false,
  });

  pgm.dropConstraint(
    "children_members",
    "children_members_relationship_type_check",
  );

  // Conversion d’éventuelles anciennes valeurs.
  pgm.sql(`
    UPDATE children_members
    SET relationship_type = 'family_or_friend'
    WHERE relationship_type IN ('family', 'friend')
  `);

  pgm.addConstraint(
    "children_members",
    "children_members_relationship_type_check",
    {
      check: `
        relationship_type IS NULL
        OR relationship_type IN (
          'mother',
          'father',
          'parent',
          'grandparent',
          'family_or_friend',
          'caregiver',
          'other'
        )
      `,
    },
  );

  // Il n’existe plus de relation personnalisée.
  pgm.dropConstraint(
    "children_members",
    "children_members_relationship_label_check",
  );

  pgm.sql(`
    UPDATE children_members
    SET relationship_label = NULL
    WHERE relationship_label IS NOT NULL
  `);

  pgm.addConstraint(
    "children_members",
    "children_members_relationship_label_check",
    {
      check: "relationship_label IS NULL",
    },
  );
};

exports.down = (pgm) => {
  pgm.dropConstraint(
    "children_members",
    "children_members_relationship_label_check",
  );

  pgm.addConstraint(
    "children_members",
    "children_members_relationship_label_check",
    {
      check: `
        relationship_type = 'other'
        OR relationship_label IS NULL
      `,
    },
  );

  pgm.dropConstraint(
    "children_members",
    "children_members_relationship_type_check",
  );

  pgm.sql(`
    UPDATE children_members
    SET relationship_type = CASE
      WHEN relationship_type IN ('mother', 'father') THEN 'parent'
      WHEN relationship_type = 'family_or_friend' THEN 'family'
      WHEN relationship_type = 'caregiver' THEN 'other'
      ELSE relationship_type
    END
  `);

  pgm.addConstraint(
    "children_members",
    "children_members_relationship_type_check",
    {
      check: `
        relationship_type IS NULL
        OR relationship_type IN (
          'parent',
          'grandparent',
          'family',
          'friend',
          'other'
        )
      `,
    },
  );

  pgm.sql(`
    UPDATE children
    SET display_name = 'Baby'
    WHERE display_name IS NULL
  `);

  pgm.alterColumn("children", "display_name", {
    notNull: true,
  });
};
