# Experiment Tracking System

A web-based lab experiment tracking system for a small geochemistry team to log experiments, upload bulk analytical data, track samples and chemicals, and visualize reactor status.

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS
- **API:** FastAPI + uvicorn
- **ORM:** SQLAlchemy 2.0
- **Database:** PostgreSQL 18 (Azure Database for PostgreSQL Flexible Server)
- **Hosting:** Azure App Service (Linux) at `https://data.addisenergy.com`; sample photos in private Azure Blob storage
- **Auth:** Firebase Authentication (@addisenergy.com only, approval gate)
- **Reporting:** Read-only per-person PostgreSQL logins on request (`docs/PSQL_ACCESS.md`)

## Quick Start (Development)

1. **Clone the repo**
   ```bash
   git clone https://github.com/mathew-h/experiment-tracking-sandbox.git
   cd experiment-tracking-sandbox
   ```

2. **Create `.env` from the example and fill in values**
   ```bash
   cp .env.example .env
   # Edit .env with your DATABASE_URL, Firebase credentials, etc.
   ```

3. **Create and activate a Python venv, then install dependencies**
   ```bash
   python -m venv .venv
   .venv/Scripts/activate   # Windows
   pip install -r requirements.txt
   ```

4. **Run database migrations**
   ```bash
   .venv/Scripts/alembic upgrade head
   ```

5. **Install frontend dependencies**
   ```bash
   cd frontend && npm install && cd ..
   ```

6. **Start the backend server**
   ```bash
   .venv/Scripts/uvicorn backend.api.main:app --reload --host 0.0.0.0 --port 8000
   ```

7. **Start the frontend dev server** (separate terminal)
   ```bash
   cd frontend && npm run dev
   ```

8. **Open the app**
   - Dev: `http://localhost:5173`
   - Production build: `http://localhost:8000`

## Production Build

Build the React app as static files; FastAPI serves them directly — no separate Node server needed.

```bash
cd frontend && npm run build
```

Then start only the backend:
```bash
.venv/Scripts/uvicorn backend.api.main:app --host 0.0.0.0 --port 8000
```

The above is the local/self-hosted run. Production is on Azure
(`https://data.addisenergy.com`), deployed nightly at 02:00 Eastern from `main` by the
"Deploy to Azure" GitHub Actions workflow. See `docs/deployment/AZURE_RUNBOOK.md`.

The lab PC Windows-service setup (`docs/deployment/PRODUCTION_DEPLOYMENT.md`) is retired
2026-12 (after the Azure switch).

## Running Tests

**Backend (pytest):**
```bash
.venv/Scripts/pytest tests/services/ tests/regression/ tests/api/ -v
```

**End-to-end (Playwright, from `frontend/` directory):**
```bash
cd frontend && npx playwright test
```

## Key Documentation

| Document | Path |
|----------|------|
| Stack reference | `docs/STACK.md` |
| Derived field formulas | `docs/CALCULATIONS.md` |
| API reference | `docs/api/API_REFERENCE.md` |
| User guides | `docs/user_guide/` |
| Milestone index | `docs/milestones/MILESTONE_INDEX.md` |
