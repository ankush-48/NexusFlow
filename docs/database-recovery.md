# Database backup and recovery rehearsal

On 24 November 2026 a PostgreSQL 17.12 source containing NexusFlow test data was backed up and restored to a freshly initialized, separate PostgreSQL 17.12 instance. The restore verified 400 rows in 28 core tables and 32 rows in seven collaboration tables. Creating and fingerprinting the two archives took 1.17 seconds. Restoring and verifying them took 2.53 seconds on the same workstation. These times describe this fixture.

## Create a backup

Use Node.js with the repository dependencies installed, the matching PostgreSQL client tools and a private directory on encrypted storage. Set `PGHOST`, `PGPORT`, `PGUSER` and supply the credential through a protected password file or the process environment. For a remote TLS connection use `PGSSLMODE=verify-full` and the appropriate `PGSSLROOTCERT`. Set `PG_BIN` if the executables are outside PATH. The backup identity needs connect and read access to both databases. The default names are `nexusflow` and `nexusflow_realtime`. Override them through `NEXUS_CORE_DATABASE` and `NEXUS_REALTIME_DATABASE` when needed.

Run from the project root with a new destination directory. Keep the archives and manifest outside source control.

```sh
node scripts/db-recovery.mjs backup /private/backups/nexusflow-release-01
```

The script exports one repeatable-read snapshot per database and gives that snapshot to both the archive writer and the row verifier. For a coordinated application recovery point, pause ingress writes, drain the outbox and workers, and pause scheduled writers before taking the pair of snapshots. The databases have independent transaction histories. Capture the corresponding attachment objects, queue state and configuration separately. [PostgreSQL backup semantics](https://www.postgresql.org/docs/17/app-pgdump.html)

## Rehearse on an isolated database server

Point the PostgreSQL connection variables at the rehearsal server. Use a role allowed to create databases. Provide the archives from your trusted backup location.

```sh
node scripts/db-recovery.mjs rehearse /private/backups/nexusflow-release-01
```

The script checks both archive hashes before connecting to the destination. Each restore uses a new, randomly named database with public connections revoked and restores in one transaction. The verifier compares every public table's row count and SHA-256 fingerprint with its original snapshot. The script prints the rehearsal database names for inspection and leaves them available. [PostgreSQL restore options](https://www.postgresql.org/docs/17/app-pgrestore.html)

The rehearsal runs as a single restore owner. For an actual cutover, restore the service-specific ownership and grants, validate attachments against the object-store backup, invalidate restored sessions and outstanding account links, reconcile pending events, then verify tenant access and a new write through the gateway. Production recovery time, cross-service failover, retention and off-site backup access require a drill on the target installation.
