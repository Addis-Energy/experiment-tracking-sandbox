# Technology Stack

## Current State
| Layer | Technology | Location |
|---|---|---|
| Frontend | React 18 + TypeScript (Vite) + Tailwind CSS | `frontend/` |
| API | FastAPI + uvicorn | `backend/api/` |
| ORM | SQLAlchemy 2.0 | `database/models/` |
| Migrations | Alembic | `alembic/` |
| Calculation Engine | Python service layer | `backend/services/calculations/` |
| Logging | structlog (structured JSON) | `backend/core/logging.py` |
| Database | PostgreSQL 18 (Azure Database for PostgreSQL Flexible Server) | Azure |
| Auth | Firebase Authentication | `backend/auth/` |
| Hosting | Azure App Service (Linux, Python 3.13, 1 worker), `https://data.addisenergy.com` | Azure |
| Photo storage | Private Azure Blob container (`PHOTO_STORAGE=blob`) | `backend/services/photo_storage.py` |
| Deployment | GitHub Actions "Deploy to Azure": nightly 02:00 Eastern from `main`, or manual run | `.github/workflows/deploy-azure.yml` |
| Reporting | Read-only per-person PostgreSQL logins on request | `docs/PSQL_ACCESS.md` |

Operations: `docs/deployment/AZURE_RUNBOOK.md`. The previous lab PC deployment (Windows
Service via NSSM, LAN-only) is retired 2026-12 (after the Azure switch); Power BI is retired.

## Legacy (superseded, reference only)
| Layer | Technology | Location |
|---|---|---|
| Frontend | Streamlit | deleted in issue #189 (2026-11-13); see git history |
| Database | SQLite file (`experiments.db`) | superseded by PostgreSQL |

The Streamlit → React/FastAPI/PostgreSQL migration completed at Milestone 8 (`docs/milestones/MILESTONE_INDEX.md`). Do not build new features against the legacy Streamlit code.

## Canonical Repository
`https://github.com/mathew-h/experiment-tracking-sandbox.git`
