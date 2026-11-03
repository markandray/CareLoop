# CareLoop

CareLoop is a screening-to-care coordination prototype. This repository currently contains the application scaffold only; product workflows are tracked in `TASKS.md`.

## Requirements

- Docker with the Compose plugin
- Node.js 22 or later and npm 10 or later (for running workspace commands locally)

## Run the application with Docker

From the repository root:

1. Copy the example environment file: `cp .env.example .env`
2. Start all services: `docker compose up --build`
3. Open the client at <http://localhost:3000>.
4. Check the server at <http://localhost:4000/health>; it returns `{"status":"OK"}`.
5. Stop the services with `Ctrl+C`; remove the containers with `docker compose down`.

The local database uses the placeholder credentials in `.env.example`. Replace them for any environment beyond local development. No real secrets are included.

## Run workspace apps locally

1. Copy environment variables: `cp .env.example .env`.
2. Install dependencies: `npm install`.
3. Start the server: `npm run dev:server`.
4. In another terminal, start the client: `npm run dev:client`.

The local server listens on port 4000 and the client on port 3000. A local PostgreSQL instance is not needed for the scaffold health route.
