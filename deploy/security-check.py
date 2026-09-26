#!/usr/bin/env python3
"""Read-only VPS checks. Run from the Compose project; never prints secrets."""
import json
import subprocess
import sys
from urllib.parse import urlsplit

PLACEHOLDERS = {
    "local-dev-only-auth-secret-min-32-chars-xx",
    "test-only-auth-secret-min-32-characters!",
    "unit-test-auth-secret-min-32-chars!!",
    "change-me-to-a-random-32-byte-secret",
    "dev-only-not-for-production", "change-me", "secret", "password", "postgres",
}


def config_errors(config):
    errors = []
    services = config.get("services", {})
    app = services.get("app", {})
    env = app.get("environment", {})
    secret = (env.get("AUTH_SECRET") or "").strip()
    if len(secret) < 32 or secret in PLACEHOLDERS:
        errors.append("AUTH_SECRET is missing, short, or a published placeholder.")
    if env.get("NODE_ENV") != "production":
        errors.append("App must run with NODE_ENV=production.")
    try:
        origin = urlsplit(env.get("APP_URL") or "")
        if origin.scheme != "https" or not origin.hostname:
            errors.append("APP_URL must be the public HTTPS origin.")
        url = urlsplit(env.get("DATABASE_URL") or "")
        if not url.username or url.username == "postgres":
            errors.append("App DATABASE_URL must use the restricted runtime role.")
        if not url.password or url.password.startswith("local-dev-only-"):
            errors.append("App database password is missing or a development placeholder.")
        owner_password = services.get("db", {}).get("environment", {}).get("POSTGRES_PASSWORD") or ""
        if not owner_password or owner_password.startswith("local-dev-only-"):
            errors.append("Database owner password is missing or a development placeholder.")
        if url.password and url.password == owner_password:
            errors.append("App and database owner must have different passwords.")
    except ValueError:
        errors.append("APP_URL or DATABASE_URL is malformed.")
    if env.get("TRUSTED_CLIENT_IP_NONE") == "1":
        errors.append("Public deployment must not disable client-IP rate limits.")
    header = env.get("TRUSTED_CLIENT_IP_HEADER") or ""
    count = env.get("TRUSTED_PROXY_COUNT") or ""
    if not ((header == "x-real-ip" and not count) or (count == "1" and not header)):
        errors.append("For the supplied single Nginx proxy, set x-real-ip OR TRUSTED_PROXY_COUNT=1.")
    for name in ("app", "db"):
        if name not in services:
            errors.append(f"Missing {name} service.")
        for port in services.get(name, {}).get("ports", []):
            if not isinstance(port, dict) or port.get("host_ip") not in ("127.0.0.1", "::1"):
                errors.append(f"{name} has a port published beyond loopback.")
    return errors


def run_json(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30, check=True)
    return json.loads(result.stdout)


def main():
    try:
        errors = config_errors(run_json(["docker", "compose", "config", "--format", "json"]))
        for service in ("app", "db"):
            result = subprocess.run(["docker", "compose", "ps", "-q", service], capture_output=True, text=True, timeout=30, check=True)
            ids = result.stdout.split()
            if not ids:
                errors.append(f"{service} is not running; live configuration is unverified.")
            for container_id in ids:
                containers = run_json(["docker", "inspect", container_id])
                for container in containers:
                    if container.get("HostConfig", {}).get("NetworkMode") == "host":
                        errors.append(f"Running {service} uses host networking.")
                    for bindings in container.get("NetworkSettings", {}).get("Ports", {}).values():
                        for binding in bindings or []:
                            if binding.get("HostIp") not in ("127.0.0.1", "::1"):
                                errors.append(f"Running {service} exposes a public port.")
        # Query as the actual app connection, without printing the connection URL.
        script = """
const { Client } = require('pg');
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const result = await db.query(`select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls,
    has_schema_privilege(current_user, 'public', 'CREATE') as schema_create
    from pg_roles where rolname = current_user`);
  console.log(JSON.stringify(result.rows[0]));
  await db.end();
})().catch(() => process.exit(1));
"""
        flags = run_json(["docker", "compose", "exec", "-T", "app", "node", "-e", script])
        if not flags or any(flags.values()):
            errors.append("Running app database role has elevated privileges.")
        for error in errors:
            print("FAIL:", error)
        if errors:
            return 1
        print("PASS: Compose settings, running port bindings, and app DB role checks.")
        print("Still verify: firewall/SSH, HTTPS certificate, Nginx header rewriting, encrypted remote restore, and authenticated role/tenant workflows.")
        return 0
    except (subprocess.SubprocessError, OSError, ValueError, TypeError, KeyError):
        # Docker config/inspect output can include credentials. Never echo it.
        print("ERROR: Checks incomplete. Confirm Docker access and healthy app/db services. No secrets printed.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
