exports.up = (pgm) => {
  /*
   * L'extension est peut-être déjà installée dans ta base.
   * ifNotExists rend cette instruction sans danger.
   */
  pgm.createExtension("citext", {
    ifNotExists: true,
  });

  pgm.createTable("family_invitations", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    family_id: {
      type: "uuid",
      notNull: true,
      references: "families",
      onDelete: "CASCADE",
    },

    child_id: {
      type: "uuid",
      notNull: true,
      references: "children",
      onDelete: "CASCADE",
    },

    invited_by_user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },

    email: {
      type: "citext",
      notNull: true,
    },

    child_role: {
      type: "varchar(20)",
      notNull: true,
      default: "contributor",
    },

    relationship_type: {
      type: "varchar(30)",
    },

    relationship_label: {
      type: "varchar(50)",
    },

    token_hash: {
      type: "text",
      notNull: true,
    },

    expires_at: {
      type: "timestamptz",
      notNull: true,
    },

    accepted_at: {
      type: "timestamptz",
    },

    accepted_by_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },

    revoked_at: {
      type: "timestamptz",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  /*
   * Pour l'instant, toutes les personnes invitées sont contributrices.
   * Si tu ajoutes le rôle viewer plus tard, une nouvelle migration
   * modifiera cette contrainte.
   */
  pgm.addConstraint(
    "family_invitations",
    "family_invitations_child_role_check",
    {
      check: "child_role = 'contributor'",
    },
  );

  /*
   * Ces valeurs correspondent exactement à celles déjà autorisées
   * dans children_members.
   */
  pgm.addConstraint(
    "family_invitations",
    "family_invitations_relationship_type_check",
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

  pgm.addConstraint(
    "family_invitations",
    "family_invitations_relationship_label_check",
    {
      check: `
        relationship_type = 'other'
        OR relationship_label IS NULL
      `,
    },
  );

  /*
   * accepted_at et accepted_by_user_id doivent être remplis ensemble.
   */
  pgm.addConstraint(
    "family_invitations",
    "family_invitations_acceptance_check",
    {
      check: `
        (
          accepted_at IS NULL
          AND accepted_by_user_id IS NULL
        )
        OR
        (
          accepted_at IS NOT NULL
          AND accepted_by_user_id IS NOT NULL
        )
      `,
    },
  );

  /*
   * Une invitation ne peut pas être acceptée puis révoquée.
   * L'accès créé dans children_members pourra, lui, être révoqué
   * séparément plus tard.
   */
  pgm.addConstraint(
    "family_invitations",
    "family_invitations_final_state_check",
    {
      check: `
        NOT (
          accepted_at IS NOT NULL
          AND revoked_at IS NOT NULL
        )
      `,
    },
  );

  /*
   * Évite une date d'expiration antérieure ou identique à la création.
   */
  pgm.addConstraint(
    "family_invitations",
    "family_invitations_expiration_check",
    {
      check: "expires_at > created_at",
    },
  );

  /*
   * Un token ne doit identifier qu'une seule invitation.
   */
  pgm.createIndex("family_invitations", "token_hash", {
    name: "family_invitations_token_hash_unique_idx",
    unique: true,
  });

  /*
   * Empêche plusieurs invitations actives pour le même enfant
   * et la même adresse email.
   *
   * Une invitation expirée devra être révoquée par le service
   * avant d'en créer une nouvelle.
   */
  pgm.createIndex("family_invitations", ["child_id", "email"], {
    name: "family_invitations_child_email_unique_pending_idx",
    unique: true,
    where: `
        accepted_at IS NULL
        AND revoked_at IS NULL
      `,
  });

  /*
   * Utilisé pour charger les invitations encore visibles
   * dans ShareChildProfileSheet.
   */
  pgm.createIndex("family_invitations", "child_id", {
    name: "family_invitations_child_id_pending_idx",
    where: `
      accepted_at IS NULL
      AND revoked_at IS NULL
    `,
  });

  /*
   * Utilisé après la connexion pour trouver les invitations
   * correspondant à l'adresse email de l'utilisateur.
   */
  pgm.createIndex("family_invitations", "email", {
    name: "family_invitations_email_pending_idx",
    where: `
      accepted_at IS NULL
      AND revoked_at IS NULL
    `,
  });

  pgm.createIndex("family_invitations", "invited_by_user_id", {
    name: "family_invitations_invited_by_user_id_idx",
  });

  pgm.createIndex("family_invitations", "accepted_by_user_id", {
    name: "family_invitations_accepted_by_user_id_idx",
    where: "accepted_by_user_id IS NOT NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("family_invitations");

  /*
   * On ne supprime pas l'extension citext :
   * elle pourrait être utilisée par d'autres tables.
   */
};
