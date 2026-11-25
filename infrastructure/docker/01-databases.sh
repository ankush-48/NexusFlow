#!/usr/bin/env bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv core_password CORE_DB_PASSWORD
\getenv realtime_password REALTIME_DB_PASSWORD
CREATE ROLE nexusflow_core LOGIN PASSWORD :'core_password';
CREATE ROLE nexusflow_realtime LOGIN PASSWORD :'realtime_password';
CREATE DATABASE nexusflow OWNER nexusflow_core;
CREATE DATABASE nexusflow_realtime OWNER nexusflow_realtime;
REVOKE CONNECT ON DATABASE nexusflow FROM PUBLIC;
REVOKE CONNECT ON DATABASE nexusflow_realtime FROM PUBLIC;
SQL
