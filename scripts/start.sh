#!/bin/sh
# Container entrypoint.
#
# Optionally applies migrations, then starts the server.
#
# Migrating on boot is off by default, because on a platform with shell access
# the right habit is to migrate deliberately, before promoting a new image: a
# schema change that fails should fail before it can take traffic, and several
# replicas booting at once should not race each other.
#
# It exists because this deployment has neither. Dokploy is driven from a web
# interface with no host shell, so a separate one-off migration step is not
# available. With a single replica and `set -e`, a failed migration aborts the
# boot rather than serving against a half-applied schema, which is the property
# that actually matters.
set -e

if [ "$RUN_MIGRATIONS_ON_BOOT" = "true" ]; then
  echo "Applying migrations before start"
  MIGRATE_TARGET=production node scripts/migrate.mjs
fi

exec node server.js
