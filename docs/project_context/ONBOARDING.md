# Onboarding Guide -- Experiment Tracking System

Welcome to the Experiment Tracking System. This guide covers how to access the web application and how to request optional read-only database access.

---

## Part 1: Connecting to the Web Application

### What you need

- A computer with internet access
- A modern web browser (Chrome, Edge, or Firefox)
- An `@addisenergy.com` email address

### Accessing the app

The Experiment Tracking System runs on Azure and is available from any network. Open your browser and navigate to:

```
https://data.addisenergy.com
```

> **Note:** Until the switch on 2026-12-03 the app still runs on the lab PC; your lab administrator will confirm the address to use until then.

### Creating an account

1. On the login screen, switch to the **Register** tab.
2. Enter your `@addisenergy.com` email, a password, your display name, and your role.
3. Click **Register**. Your request will be submitted for admin approval.
4. You will not be able to log in until an administrator approves your account. They will let you know when access is ready.

### Logging in

1. Navigate to the app URL.
2. On the **Login** tab, enter your `@addisenergy.com` email and password.
3. Click **Login**. If your account has been approved, you will be taken to the main dashboard.

If you see a "pending approval" message, your account has not yet been approved. Contact your lab administrator.

### Troubleshooting

| Problem | What to check |
|---------|---------------|
| Page does not load | Check your internet connection and that the address is exactly `https://data.addisenergy.com`. |
| "Service unavailable" or error page | The app may be restarting after the nightly 02:00 update. Wait a minute and retry; if it persists, ask the administrator to check `https://data.addisenergy.com/health`. |
| "Pending approval" after registering | Your account needs admin approval. Reach out to the lab admin. |
| Forgotten password | Contact the lab admin to reset your password via the management CLI. |

---

## Part 2: Direct database access (optional, read-only)

Power BI is no longer used. If you want to query the reporting views directly
(psql, Python, DBeaver), ask your lab administrator for a personal read-only
login. Access is by request: give them your current public IP address (search
"what is my IP"); they add a firewall rule for it and send you a connection
string. See `docs/PSQL_ACCESS.md` for how to connect and which views to use.

---

## Getting Help

If you run into issues not covered here, contact your lab administrator. They can check service status, reset passwords, and verify network and database connectivity.
