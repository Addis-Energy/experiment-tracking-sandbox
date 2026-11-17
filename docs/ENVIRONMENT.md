# Environment and Permissions

## Deployment Reality
- **Production:** Azure App Service (Linux) + PostgreSQL Flexible Server + private Blob storage, at `https://data.addisenergy.com`. Deployed nightly from `main` by GitHub Actions. See `docs/deployment/AZURE_RUNBOOK.md`.
- **Users:** the team, via browser over HTTPS from any network
- **No Docker in production or development**
- React app is served as static files by FastAPI — no separate Node server in production
- The previous lab PC on the LAN is retired 2026-12 (after the Azure switch on 2026-12-03)
- Local dev runs natively (Python venv + `npm run dev`) — see `README.md` Quick Start and `docs/deployment/STARTUP_GUIDE.md`

## Environment Variables (never hardcode these)
```
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/experiments

# Firebase
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# App
APP_ENV=development|production
API_PORT=8000
CORS_ORIGINS=http://localhost:5173   # Azure: https://data.addisenergy.com
LOG_LEVEL=INFO
TZ=                                   # Azure: America/New_York (App Service setting)

# Sample photos
PHOTO_STORAGE=local                   # local (default) | blob (Azure)
AZURE_STORAGE_ACCOUNT_URL=            # blob only, e.g. https://<account>.blob.core.windows.net
AZURE_PHOTO_CONTAINER=sample-photos   # blob only; container is private

# Backups (retired with the lab PC; Azure uses Flexible Server backups, 35 days)
BACKUP_DIR=
PUBLIC_COPY_DIR=
```

On Azure these are App Service application settings, never committed. `ENABLE_API_DOCS`
is never set on Azure. Blob access uses the app's managed identity, not a key.

## Permitted Operations
- Read and write to this Git repository
- Fetch external documentation via Context7 MCP (`resolve-library-id` then `get-library-docs`) for all stack libraries: FastAPI, React, PostgreSQL, SQLAlchemy, Alembic, Firebase, Tailwind, Vite, Vitest, structlog, TanStack Query, Pydantic, psycopg2
- Research full-stack experimental data tracking best practices
- Run tests, linters, formatters, and build tools within the repo
- Run database migrations against the local development database
- Install packages listed in `requirements.txt` or `package.json`
- Use GitHub MCP to create PRs, manage issues, and check CI status
- Use Playwright MCP for E2E test execution (Milestone 8 and `frontend-builder` verification)
- Use Chrome DevTools MCP for the frontend-builder closed-loop (Milestone 4 onward)

## Not Permitted
- Accessing or modifying the production database directly
- Deploying to production without explicit user instruction
- Installing new third-party packages without proposing them to the user first and receiving approval
- Accessing any external service not listed above
- Modifying `.env` files — only read them; never commit secrets
- Committing directly to `main` or `develop`
