# Going live (hosting Zawli)

This guide puts Zawli on the internet with HTTPS, a database, daily backups and real MTN MoMo / Airtel Money payments. **Nothing here has been bought or set up yet** — every step below is yours to approve and pay for.

## What you need

| Item | Why | Typical cost |
| --- | --- | --- |
| A **domain name** (e.g. `zawli.ug` or `app.yourbrand.com`) | QR codes and payment callbacks need a permanent HTTPS address | Yearly fee from a domain registrar |
| A **Linux server** (VPS), 2 GB RAM / 1–2 CPUs / 40 GB disk, Ubuntu 24.04 | Runs the app, database and HTTPS | Small monthly fee (DigitalOcean, Hetzner, AWS Lightsail, Linode, Vultr…). Pick a region close to Uganda (e.g. Johannesburg or Europe) |
| **MTN MoMo** and/or **Airtel Money** API access — per restaurant | Real mobile money payments go to each restaurant's own merchant account | Set by MTN / Airtel; requires the restaurant's business registration |

Check current prices with each provider before buying — they change. One server comfortably handles your first several restaurants. Everything else used here (Docker, PostgreSQL, Caddy, Let's Encrypt) is free.

Why one server: Zawli keeps live kitchen connections open and checks pending payments every 20 seconds, so it needs an always-on server — not "serverless" hosting.

## Step 1 — Prepare the server (once)

1. Create the VPS (Ubuntu 24.04) and note its **public IP address**.
2. At your domain registrar, add a DNS **A record**: your domain → the server's IP. Wait until it resolves (`ping yourdomain` shows the IP).
3. Log in (`ssh root@SERVER_IP`) and install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
4. Turn on the firewall, allowing only SSH and web traffic:
   ```bash
   ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
   ```

## Step 2 — Put the code on the server

Use Git (recommended — install Git on your computer and push the project to a private GitHub/GitLab repository), then on the server:

```bash
git clone <your-private-repo-url> zawli && cd zawli
```

(Without Git: zip the project folder **without** `node_modules`, `.next`, `.pg-data`, `storage` and `.env`, copy it with `scp`, and unzip.)

## Step 3 — Secrets

```bash
cp deploy/.env.production.example deploy/.env.production
nano deploy/.env.production
```

Fill in `DOMAIN`, and generate each secret with `openssl rand -base64 32`. **Keep `PAYMENT_SECRETS_KEY` safe and never change it** — it decrypts the restaurants' MTN/Airtel keys. Store a copy of this file in a password manager.

## Step 4 — Start

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```

The first build takes several minutes. Caddy then fetches the HTTPS certificate automatically. Check:

```bash
curl https://YOUR_DOMAIN/api/health        # → {"status":"ok","database":"ok",...}
docker compose -f deploy/docker-compose.prod.yml logs -f app   # live logs (Ctrl+C to leave)
```

Database migrations run automatically every time the app starts.

## Step 5 — Create your platform admin

No default password exists. Create the first admin and get a one-time setup link:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec \
  -e BOOTSTRAP_ADMIN_EMAIL=you@example.com -e BOOTSTRAP_ADMIN_NAME="Your Name" app npm run admin:create
```

Open the printed link, choose a password, sign in at `https://YOUR_DOMAIN/login` → **Platform administration**.

Do **not** run the demo seed on the live server — it creates fictional restaurants and test accounts.

## Step 6 — Onboard the first restaurant

1. Admin → **Restaurants → New restaurant** → copy the owner's setup link and send it privately (WhatsApp/SMS).
2. The owner signs in, adds the menu and tables, and prints the QR sheet (**Tables & QR codes → Print all QR codes**). The QR codes point at your domain, so print them only after going live on the final domain.
3. Owner → **Restaurant settings → Mobile money payments**:
   - **MTN MoMo:** environment **Live**; enter the Collection subscription key, API user, API key and target environment (e.g. `mtnuganda`) from MTN.
   - **Airtel Money:** environment **Live**; enter the Client ID and secret from Airtel.
   - Click **Test connection**, then tick **Accept …** and save.
   - Ask MTN/Airtel to whitelist the callback URL `https://YOUR_DOMAIN/api/public/payments/callback` (optional — Zawli also checks payment status itself).
4. Admin → the restaurant → **Go live** once the checklist is complete.
5. Place one small real order and pay it, before opening to guests.

Tip: test with **Sandbox / UAT** first (MTN sandbox: `momodeveloper.mtn.com`; Airtel UAT: `developers.airtel.africa`) using the providers' test numbers.

## Backups

- The `backup` service writes a full database dump every 24 hours to the `backups` volume and keeps 14 days.
- **Also copy backups off the server** (a server can be lost). Example, from your computer:
  ```bash
  scp root@SERVER_IP:/var/lib/docker/volumes/zawli_backups/_data/zawli-YYYY-MM-DD.dump .
  ```
  or enable your VPS provider's automatic snapshots.
- Restore into the running database:
  ```bash
  docker compose -f deploy/docker-compose.prod.yml exec -T db pg_restore --clean --if-exists -U zawli -d zawli < zawli-YYYY-MM-DD.dump
  ```
- Uploaded menu photos are in the `uploads` volume — include it in snapshots.

## Updating to a new version

```bash
cd zawli && git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```

Take a backup first (`docker compose ... exec backup sh -c 'pg_dump -h db -U zawli -d zawli -Fc -f /backups/before-update.dump'`).

## Good to know

- **One server for now.** Running several app servers later needs a shared rate limiter, shared live-update signal and shared photo storage (see ROADMAP).
- **Emails/SMS** are not sent automatically yet; setup links are copied from the screen.
- **Security:** keep the server updated (`apt update && apt upgrade`), use SSH keys instead of passwords, and limit who has the admin account.
- Using a managed database instead (Neon, Supabase, your VPS provider's): remove the `db` and `backup` services and set `DATABASE_URL` for the `app` service to the provider's connection string.
