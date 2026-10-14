# VPS Deployment Runbook - 167.86.108.178

This runbook deploys the current GitHub project to the VPS at `167.86.108.178` using Docker Compose.

## Local Push

Run these commands on your local machine from the project root.

```powershell
cd F:\Projects\ideashop-zeaplay-v5
git status
git add -- .env.production.example docker-compose.prod.yml backend/app/config.py backend/app/main.py docs/vps-deployment-167-86-108-178.md
git commit -m "Prepare VPS deployment for 167.86.108.178"
git push origin main
```

If you also want to publish current frontend work already in your working tree, stage those files explicitly in the same commit:

```powershell
git add -- frontend/index.css frontend/pages/Logs.tsx frontend/test/audit-logs-redesign.test.ts
git commit -m "Prepare VPS deployment for 167.86.108.178"
git push origin main
```

## First-Time Server Setup

Connect to the VPS.

```bash
ssh root@167.86.108.178
```

Install Docker, Compose, Git and firewall tooling on Ubuntu.

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version
docker compose version
```

Open the required ports.

```bash
ufw allow OpenSSH
ufw allow 6300/tcp
ufw allow 6311/tcp
ufw allow 6312/tcp
ufw --force enable
ufw status
```

Clone the project from GitHub.

```bash
mkdir -p /opt
git clone https://github.com/urlprojectsmith/ideashop-zeaplay.git /opt/ideashop-zeaplay
cd /opt/ideashop-zeaplay
git checkout main
```

Create the production environment file.

```bash
cp .env.production.example .env.production
nano .env.production
```

Before starting, replace these values in `.env.production`:

```text
POSTGRES_PASSWORD=change-this
VEE_DATABASE_URL=postgresql+psycopg://vee_user:change-this@postgres:5432/vee_task_manager
VEE_JWT_SECRET_KEY=change-this-to-a-long-random-secret
VEE_JWT_REFRESH_SECRET_KEY=change-this-to-a-different-long-random-secret
PRESENCE_JWT_SECRET=change-this-to-a-long-random-secret
VEE_MINIO_ENDPOINT=...
VEE_MINIO_ACCESS_KEY=...
VEE_MINIO_SECRET_KEY=...
VEE_MINIO_PUBLIC_BASE=...
VEE_VAPID_PUBLIC_KEY=...
VEE_VAPID_PRIVATE_KEY=...
VEE_VAPID_SUBJECT=mailto:your-email@example.com
```

Start the app.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Check logs.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f frontend
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f presence
```

Smoke test the deployment.

```bash
curl -I http://167.86.108.178:6300
curl http://167.86.108.178:6300/api/health
curl http://167.86.108.178:6311/health
```

Expected URLs:

```text
Frontend: http://167.86.108.178:6300
API through frontend proxy: http://167.86.108.178:6300/api
Direct API: http://167.86.108.178:6311
Presence service: http://167.86.108.178:6312
```

## Update Deployment

Use this after pushing a new commit to GitHub.

```bash
ssh root@167.86.108.178
cd /opt/ideashop-zeaplay
git status
git pull origin main
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -I http://167.86.108.178:6300
curl http://167.86.108.178:6300/api/health
```

## Database Backup

Run this before pulling major changes.

```bash
cd /opt/ideashop-zeaplay
set -a
. ./.env.production
set +a
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "backup_$(date +%F_%H%M%S).sql"
ls -lh backup_*.sql
```

## Rollback

Use this if a deployment fails after a pull.

```bash
cd /opt/ideashop-zeaplay
git log --oneline -5
git checkout <previous-good-commit>
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

To return to normal branch tracking after rollback testing:

```bash
git checkout main
git pull origin main
```

## Notes

- Do not commit `.env.production`; it contains secrets.
- The Compose file uses `.env.production` by default. For local syntax checks against the sample file, run `ZEAPLAY_ENV_FILE=.env.production.example docker compose --env-file .env.production.example -f docker-compose.prod.yml config`.
- `docker-compose.prod.yml` builds images from the pulled Git checkout, so server updates follow `git pull`.
- The old production worker images were removed from this Compose file because this checkout does not include matching Celery/reporting worker modules.
- If you later add a domain and HTTPS, update `.env.production`, `VEE_CORS_ALLOW_ORIGINS`, `PRESENCE_CORS_ORIGINS`, and reverse-proxy rules together.
