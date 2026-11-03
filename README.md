# CareLoop

CareLoop is a synthetic screening-to-care coordination prototype. The current server includes authentication, role checks, and the health endpoint; workflow modules are tracked in `TASKS.md`.

## Requirements

- Docker with the Compose plugin
- Node.js 22 or later and npm 10 or later for local workspace commands

## Run with Docker

From the repository root:

```sh
cp .env.example .env
docker compose up --build
```

Open the client at <http://localhost:3000>. The server health check is <http://localhost:4000/health> and returns `{"status":"OK"}`. Stop the attached services with `Ctrl+C`.

The values in `.env.example` are local placeholders, not production secrets. In particular, `JWT_SECRET` and `DEMO_PASSWORD` must be replaced outside a local demo. Do not reuse the demo password or check real secrets into the repository.

## Seed demo users

In another terminal, run the idempotent seed command:

```sh
npm run seed
```

This applies any pending migrations and creates three providers, staff accounts, and two synthetic patients (English and Arabic). Local demo login: `admin@careloop.local` (or another seeded account) with the `DEMO_PASSWORD` from `.env`; the example value is `CareLoopDemo2026!`. This is demo-only and must be changed before any hosted deployment.

## Auth curl examples

The API is rooted at `http://localhost:4000/api/v1`. These examples use the example demo password. If you changed `DEMO_PASSWORD`, use that value instead.

```sh
# Wrong password: HTTP 401 with the same generic response used for an unknown email.
curl -i http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@careloop.local","password":"wrong"}'

# Login: saves the httpOnly, SameSite=Strict session cookie to a local cookie jar.
curl -i -c cookies.txt http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@careloop.local","password":"CareLoopDemo2026!"}'

# Read the authenticated session.
curl -i -b cookies.txt http://localhost:4000/api/v1/auth/me

# Logout clears the cookie.
curl -i -b cookies.txt -c cookies.txt -X POST http://localhost:4000/api/v1/auth/logout

# The cleared cookie no longer authenticates.
curl -i -b cookies.txt http://localhost:4000/api/v1/auth/me
rm cookies.txt
```

## Tests

Run unit tests:

```sh
npm test
```

The database is reachable only inside the Compose network. Create `careloop_test` once in the existing database container, then run the database-backed core and auth tests. This command targets `careloop_test`; it does not use the demo database.

```sh
docker compose up -d db
docker compose exec -T db createdb -U careloop careloop_test
npm run test:db
```

If `careloop_test` already exists, skip the `createdb` command. The tests apply pending migrations and create only synthetic test records there. PostgreSQL has no published host port.

## Run workspace apps locally

Install dependencies with `npm install`, provide the environment values from `.env.example` in the shell, then run `npm run dev:server` and `npm run dev:client` in separate terminals. A local PostgreSQL service is required by the server.
