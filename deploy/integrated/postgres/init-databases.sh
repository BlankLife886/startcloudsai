#!/bin/sh
set -eu

create_role_and_database() {
  database_name=$1
  database_user=$2
  database_password=$3

  psql --username "$POSTGRES_USER" --dbname postgres \
    --set=database_name="$database_name" \
    --set=database_user="$database_user" \
    --set=database_password="$database_password" <<-'SQL'
	SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'database_user', :'database_password')
	WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'database_user') \gexec
	SELECT format('CREATE DATABASE %I OWNER %I', :'database_name', :'database_user')
	WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'database_name') \gexec
SQL
}

create_role_and_database "$STARCLOUD_DB_NAME" "$STARCLOUD_DB_USER" "$STARCLOUD_DB_PASSWORD"
create_role_and_database "$CHATGPT2API_DB_NAME" "$CHATGPT2API_DB_USER" "$CHATGPT2API_DB_PASSWORD"
