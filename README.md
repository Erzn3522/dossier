<p align="center">
  <img src="src/app/icon.svg" alt="" width="80" height="80">
</p>

<h1 align="center">Dossier</h1>

<p align="center">
  Your job search, on your own server: one profile, a tailored resume and cover letter for every job, and every application tracked from draft to offer.
</p>

<p align="center">
  <a href="https://github.com/AienTech/dossier/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/AienTech/dossier?label=release"></a>
  <a href="https://github.com/AienTech/dossier/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/AienTech/dossier/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <a href="https://github.com/AienTech/dossier/pkgs/container/dossier"><img alt="Docker image: ghcr.io/aientech/dossier" src="https://img.shields.io/badge/image-ghcr.io%2Faientech%2Fdossier-2496ED?logo=docker&logoColor=white"></a>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs">
  <img alt="PostgreSQL 18" src="https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white">
</p>

Dossier keeps your career history in one profile and turns it into a clean resume. For every job you apply to, it reads the posting, shows how you match, and drafts a tailored resume and cover letter that only use facts from your profile. You refine them in a chat, download them as PDFs and track each application from draft to offer.

This fork goes further than the original: a daily automated job search across seven sources, a Review queue where the AI prepares each application for you to approve, **Quick apply** for postings you find yourself, answers to application-form questions, and sending through your own Gmail. [What this fork adds](#what-this-fork-adds) sums it up.

It's for one person on a small server: one password, your data in your own PostgreSQL database, and an AI model of your choice. That can be a local model through Ollama, so your profile and documents never leave your server, or a hosted one (any OpenAI-compatible API, or Anthropic), which then receives what it writes from. [Privacy](#privacy) says what goes where.

## Demo

![Dossier in use: the dashboard, dragging a card on the board, a new application from a pasted posting, refining the tailored resume in the chat, the cover letter, and switching resume themes](.github/images/demo.gif)

<sub>Recorded with the demo data (Jane Doe is made up) and a stand-in AI server that answers at once, played at 1.2× speed. With a real model, reading a posting and writing the documents takes from a few seconds to a few minutes.</sub>

## Features

- **Profile:** basics, skills and languages, experience, education and references, in the order you choose, with a strength meter. Start it from an existing resume (PDF, Word or Markdown) if you like.
- **Base resume:** twelve themes and a theme builder, previewed live and printed to PDF on the server. Duplicate themes, or share them as files.
- **Find jobs:** search postings near your city, or anywhere you choose, through JSearch (LinkedIn, Indeed and more), Adzuna, Germany's Bundesagentur für Arbeit, Remote OK, Remotive, We Work Remotely, Himalayas, Jobicy or Arbeitnow. Save the good ones, dismiss the rest, and start an application from a posting with one click.
- **New application:** paste a posting; Dossier pulls out the details and requirements, matches them against your profile, and writes a tailored resume and cover letter in the tone you pick.
- **Never invents experience:** drafts only use facts from your profile. What the posting asks for and your profile doesn't have is shown as a gap, not made up.
- **Refine:** ask for changes in a chat, edit or regenerate any part (every part of the cover letter too: sender, date, recipient, greeting and sign-off, written in the letter's language), undo AI changes or go back to any earlier version, keep private notes. Paste a question from the company's application form ("Why do you want to work here?") and the chat answers it in your voice, ready to paste, without touching the documents.
- **Automated search:** saved search profiles run every day across seven sources; new postings are matched, filtered and prepared in the background.
- **Review:** every prepared application waits for your approval, with a live progress bar while the AI works and filters by status, text, match range, work mode, source and profile.
- **Quick apply:** found a job yourself? Give its link or paste it, and get what to fix in your CV, a cover letter, a tailored CV and an email you can send with Gmail.
- **Send:** an email to go with each application, written by you to the company, to whoever the posting says to send it to. Copy it, open it in your mail app, or send it with the resume and cover letter attached through your connected Gmail, one confirmed email at a time. Edit, rewrite or refine it like the documents.
- **Track:** a board and a table of every application, and a dashboard with your funnel (last 30 days, 90 days or all time), a week-by-week chart and what's worth a look next, upcoming interviews included.
- **Your data:** export and import everything as one file, nightly backups, and Delete everything.

## Screenshots

![The dashboard: your funnel, a week-by-week chart and what's worth a look next](.github/images/dashboard.png)

<table>
  <tr>
    <td width="50%"><img src=".github/images/application.png" alt="An application with its tailored resume and the chat that refines it"><br>An application: the tailored resume, and a chat to refine it</td>
    <td width="50%"><img src=".github/images/new-application.png" alt="A new application, showing how the profile matches the posting's requirements"><br>A new application: how you match the posting</td>
  </tr>
  <tr>
    <td><img src=".github/images/applications.png" alt="The applications board, with columns from draft to offer"><br>Every application on a board, from draft to offer</td>
    <td><img src=".github/images/find-jobs.png" alt="Find jobs: postings near the profile's city, with one open"><br>Find jobs and start an application from a posting</td>
  </tr>
  <tr>
    <td><img src=".github/images/resume.png" alt="The base resume next to its themes"><br>The base resume, with twelve themes and a theme builder</td>
    <td><img src=".github/images/profile.png" alt="The profile editor, with its sections and strength meter"><br>One profile that every resume and letter comes from</td>
  </tr>
</table>

<sub>The screenshots show the demo data: Jane Doe is made up.</sub>

## Self-hosting

Dossier runs as two containers, the app and PostgreSQL, from one Compose file. These four steps take a fresh server to Dossier on your own domain, with HTTPS.

### 1. Get a VPS

Any Linux server you can reach over SSH works, from any provider. Give it:

- **At least 2 vCPUs and 2 GB of memory.** Dossier uses up to about 1 GB, since it prints PDFs with a built-in Chromium; PostgreSQL and the system need the rest (see [Performance and sizing](#performance-and-sizing)).
- **A few GB of disk.** The image is about 1.7 GB; your data takes far less.
- **More for a local model:** about 6 GB of extra memory and 4 or more cores for `qwen2.5:7b` (see [Local model with Ollama](#local-model-with-ollama)). With a hosted AI provider, you don't need any of that.
- **A domain name** for HTTPS, such as `dossier.example.com`, with a DNS `A` record pointing at the server.

The commands below are for Debian or Ubuntu. Only SSH (port 22) and the web (80 and 443) need to be open to the internet.

### 2. Install Docker and Docker Compose

Docker's install script sets up Docker Engine and the Compose plugin:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

The last line lets you run `docker` without `sudo` (membership in the `docker` group is as good as root, so only add accounts you trust). Log out and back in for it to apply, then check:

```bash
docker compose version
```

To install by hand instead, follow [Docker's guide for your distribution](https://docs.docker.com/engine/install/).

### 3. Set up the database

Dossier keeps everything in PostgreSQL 18, which runs in its own container next to the app. Nothing outside can reach it, only the app, and its data lives in a Docker volume that survives restarts and upgrades.

Make a folder for Dossier, fetch the Compose file into it, and give the database a random password:

```bash
mkdir ~/dossier && cd ~/dossier
curl -fsSL -o compose.yml https://raw.githubusercontent.com/AienTech/dossier/main/compose.production.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
chmod 600 .env
```

`.env` holds your secrets, so it's readable only by you. The database starts with the app in the next step; Compose waits until it's ready before it starts Dossier.

### 4. Set up the app

Dossier needs two more secrets in `.env`:

- **`DOSSIER_SECRET`:** 32 or more random characters. It signs sessions and encrypts saved API keys.
- **`DOSSIER_PASSWORD`:** a hash of the password you'll sign in with. Dossier only takes the hash, never the password itself, so reading the server's settings doesn't reveal it.

```bash
echo "DOSSIER_SECRET=$(openssl rand -base64 32)" >> .env
docker run --rm -it ghcr.io/aientech/dossier hash-password
```
_Note_: In case you are building or running it locally on Apple Silicon (M-series Mac), use the following command to specify the platform:
```bash
docker run --platform linux/amd64 --rm -it ghcr.io/aientech/dossier hash-password
```

Type your password twice. The command prints one line that starts with `argon2id:`; add it to `.env` as `DOSSIER_PASSWORD=argon2id:…` (for example with `nano .env`). Then start Dossier and watch it come up:

```bash
docker compose up -d
docker compose logs -f app
```

On every start, Dossier applies the database migrations and loads its built-in themes before it serves, and the log shows each step. Press Ctrl+C to stop following it. `curl -s localhost:3000/api/health` answers `{"status":"ok", …}` once it's up.

**HTTPS.** Dossier only listens on the server itself (`127.0.0.1:3000`), so put a reverse proxy with HTTPS in front of it. [Caddy](https://caddyserver.com) gets and renews the certificate on its own. Install it (on older releases, see [Caddy's install guide](https://caddyserver.com/docs/install)) and replace its default configuration with your domain:

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
dossier.example.com {
    reverse_proxy localhost:3000
}
EOF
sudo systemctl reload caddy
```

Open `https://dossier.example.com` and sign in. Then pick an AI model in **Settings → AI provider** (see [Choosing an AI provider](#choosing-an-ai-provider)) and, if you like, a job source in **Settings → Job search**.

<details>
<summary>Another proxy, or no HTTPS at home</summary>

- **Traefik, nginx or another proxy:** it has to set `X-Forwarded-Proto` and append the client's address to `X-Forwarded-For`. Caddy and Traefik do both by default; with nginx, add `proxy_set_header X-Forwarded-Proto $scheme;` and `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, and raise `client_max_body_size` to `12m` so imports of up to 10 MB get through. Dossier relies on these headers: `X-Forwarded-Proto: https` makes the session cookie `Secure`, and the last address in `X-Forwarded-For` is the client the sign-in rate limit counts. So never expose port 3000 itself to the internet: requests that skip the proxy could set those headers themselves.
- **A home network without a domain:** change the app's `ports` entry in `compose.yml` to `"3000:3000"`, run `docker compose up -d`, and open `http://<the server's address>:3000`. Everything works, but the session cookie can't be marked `Secure`.

</details>

## Environment variables

Dossier is configured with environment variables; everything else is set in the app. Put them in `.env` next to `compose.yml`, then run `docker compose up -d` to apply them (a plain restart keeps the old values). The server doesn't start while a required variable is missing or invalid, and its log says which one and how to fix it.

**Required:**

| Variable | What it's for |
|---|---|
| `POSTGRES_PASSWORD` | The database's password. `compose.yml` builds the app's `DATABASE_URL` from it. |
| `DOSSIER_PASSWORD` | A hash of the password you sign in with, made with `hash-password` (see [step 4](#4-set-up-the-app)); the password itself isn't accepted. It's only read from here, never stored. Changing it signs every session out. |
| `DOSSIER_SECRET` | At least 32 random characters. Signs sessions and encrypts saved API keys; changing it signs everyone out, and API keys have to be entered again. |

**Optional:**

| Variable | Default | What it's for |
|---|---|---|
| `TZ` | `UTC` | The server's time zone, e.g. `Europe/Berlin`. Nightly backups run at 03:00 in it, and dates the server writes (a letter's date, "today") follow it. |
| `DOSSIER_BACKUP_RETENTION_DAYS` | `14` | How many days of nightly backups to keep. |
| `DOSSIER_TELEMETRY` | `on` | `off` stops the usage ping, which sends a random install ID and the version number once on each day Dossier is used (see [Privacy](#privacy)). |
| `DOSSIER_AI_PROVIDER` | none | `local` (Ollama or llama.cpp), `openai` (any OpenAI-compatible API) or `anthropic`. A default for Settings → AI provider; a choice saved there wins. |
| `DOSSIER_AI_URL` | per provider | The AI server's address, e.g. `http://ollama:11434`. |
| `DOSSIER_AI_MODEL` | per provider | The model to use, e.g. `qwen2.5:7b` or `claude-sonnet-5`. |
| `DOSSIER_AI_KEY` | none | The API key for a hosted provider. |
| `DOSSIER_AI_TIMEOUT_SECONDS` | `300` local, `120` hosted | How long one AI request may take. |
| `DOSSIER_JOBS_SOURCE` | off | `jsearch`, `adzuna`, `arbeitsagentur`, `remote-ok`, `remotive`, `we-work-remotely`, `himalayas`, `jobicy`, `arbeitnow` or `off`. A default for Settings → Job search; a choice saved there wins. |
| `DOSSIER_JSEARCH_KEY` | none | A JSearch key, from OpenWeb Ninja or RapidAPI. |
| `DOSSIER_JSEARCH_HOST` | `openwebninja` | Where that key is from: `openwebninja` or `rapidapi`. |
| `DOSSIER_ADZUNA_APP_ID`, `DOSSIER_ADZUNA_KEY` | none | Adzuna's app ID and key. |
| `DOSSIER_SEARXNG_URL` | none | A private SearXNG address, e.g. `http://searxng:8080`, for finding public application emails when a posting has none. |
| `DOSSIER_IMAGE` | `ghcr.io/aientech/dossier:latest` | The image to run. Set a version, e.g. `ghcr.io/aientech/dossier:v1.4.1`, to upgrade only when you choose. |
| `DOSSIER_PORT` | `3000` | The port on the server (`127.0.0.1`) that Dossier listens on, for the reverse proxy. |
| `COMPOSE_PROFILES` | none | `ai` runs Ollama; `email-discovery` runs SearXNG. Use a comma between both. |

Running the image without the Compose file? Set `DATABASE_URL` (`postgresql://user:password@host:5432/database`) instead of `POSTGRES_PASSWORD`, and mount a volume at `/data`, where nightly backups and zipped PDFs go.

## Choosing an AI provider

Open **Settings → AI provider**, pick one, and press **Test connection**:

- **Local model:** Ollama or llama.cpp on your own hardware. Private and free, but slower; see [below](#local-model-with-ollama) for setup and model sizes.
- **OpenAI-compatible:** OpenAI itself or any server that speaks its API (OpenRouter, vLLM, LM Studio and others). Enter its address, your API key and the model.
- **Anthropic:** Claude models with your own API key.

API keys are stored encrypted with `DOSSIER_SECRET` and never sent back to the browser. **Never invent experience** (on by default) keeps drafts to facts from your profile and flags anything it can't find there.

### Local model with Ollama

With a local model, your profile, postings and documents never leave your server. The Compose file can run Ollama next to Dossier. Switch it on, start it, and pull a model:

```bash
echo "COMPOSE_PROFILES=ai" >> .env
docker compose up -d
docker compose exec ollama ollama pull qwen2.5:7b
```

Then, in **Settings → AI provider → Local model**, set the server address to `http://ollama:11434`, pick the model and press **Test connection**. Or set `DOSSIER_AI_PROVIDER=local`, `DOSSIER_AI_URL=http://ollama:11434` and `DOSSIER_AI_MODEL=qwen2.5:7b` in `.env`.

**Which model:** `qwen2.5:7b` is a good start: a 4.7 GB download that needs about 6 GB of memory with Dossier's 16k-token context. On a smaller server, `qwen2.5:3b` (2 GB, about 3 GB of memory) works, with plainer writing. These are suggestions, not yet benchmarked. On a CPU, reading a posting takes a minute or two and a whole new application several minutes, so the local timeout is 5 minutes per request (`DOSSIER_AI_TIMEOUT_SECONDS`); 4 or more cores help, a GPU much more.

**Ollama elsewhere:** on another machine in your network, use `http://<its address>:11434`, and start Ollama there with `OLLAMA_HOST=0.0.0.0` so it listens beyond localhost. For Ollama installed on the same server outside Docker, use `http://host.docker.internal:11434`, which `compose.yml` points at the server; Ollama then has to listen beyond localhost too, so make sure your firewall keeps port 11434 closed to the internet. Inside a container, `localhost` is the container itself, never the server.

## Choosing a job source

Find jobs is off until you pick a source in **Settings → Job search**. LinkedIn and Indeed don't let other apps read their job listings, so Dossier searches one of these instead:

| Source | What it covers | Key and cost |
|---|---|---|
| **JSearch** | Google for Jobs: postings from LinkedIn, Indeed, Glassdoor, Stepstone and company sites, in most countries, with their whole text. | A key from [OpenWeb Ninja](https://www.openwebninja.com/api/jsearch) or [RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch). The free plan has 200 searches a month; each page of results is one. |
| **Adzuna** | Adzuna's own index in 19 countries. It only shares the start of each posting; Dossier fetches the rest from the posting's page. | A free app ID and key from [Adzuna's developer site](https://developer.adzuna.com/signup), about 250 searches a day. |
| **Bundesagentur für Arbeit** | Germany's federal job board, with whole postings. Germany only. | No key, free. It isn't an official API (it's the access the agency's own site uses), so it can change without notice. |
| **Remote OK** | Remote OK's worldwide remote-job feed, filtered by Dossier. | Public JSON feed; free and no key. Results link back to Remote OK. |
| **Remotive** | Curated worldwide remote jobs, published with an intentional delay. | Public API; free and no key. Dossier shares one six-hour snapshot across searches and links back to Remotive. |
| **We Work Remotely** | Worldwide remote jobs from We Work Remotely. | Public RSS feed; free and no key. Results link back to We Work Remotely. |
| **Himalayas** | Worldwide remote jobs, searched by keyword and country. | Public API; free and no key. Answers are cached for a day; its application links are kept unchanged and credited to Himalayas. |
| **Jobicy** | Remote jobs from Jobicy's public API. | Free and no key. Read at most once an hour, as Jobicy asks, and credited to Jobicy. |
| **Arbeitnow** | Jobs from European companies, many in Germany, on site and remote. | Public job-board API; free and no key. Cached for an hour and credited to Arbeitnow. |

The search starts from your profile's city, country and current role; change the place, radius (10 to 200 km), how recent and Remote only as you like. Every search is kept with what it found until you remove it, under **Past searches**, so going back to one, or reloading, doesn't spend another search.

## Automated search and Gmail

Under **Find jobs**, save one or more searches as automatic profiles. **Settings → Automation** controls the daily time and IANA time zone (08:00 UTC by default), the match threshold and mandatory language/experience filtering. Daylight-saving changes follow the selected zone automatically. Every profile searches seven sources in parallel: JSearch, Remote OK, Remotive, We Work Remotely, Himalayas, Jobicy and Arbeitnow. A source that fails doesn't stop the others; the last run's matches and errors are shown per source on **Find jobs**. JSearch gets a 20-second timeout and one retry on a network or server error. Dossier filters the keyless feeds locally (date, country, remote), removes duplicates across all profiles by link and by company and role, and round-robins the sources, so a 30-candidate run takes about four or five from each source when every source has enough matches, while unused capacity moves to sources with more results. Keywords can be alternatives in quotes, e.g. `"computer vision" OR "machine vision" OR "robotics engineer"`; plain keywords still all have to match. The 10–30 limit bounds the slower AI analysis, not the number of feed entries scanned.

While a run is in progress, **Review** shows a progress bar: profiles searched, postings scanned, how many went to the AI and how many it has finished, with an estimate of the time left. It refreshes itself until the AI is done. Filter the queue by status (ready, filtered out, waiting for the AI, failed), text, a match range, work mode, source and search profile, and sort it by date, match or company.

To replace every automatic profile at once, `docker/bin/yarn configure-job-automation` sets up the 35 city profiles in `src/lib/automation/profile-plan.ts` (EU capitals and tech hubs, Slovenia and Türkiye; remote-only except in Slovenia; last 7 days, 3 pages each) and turns the daily run on a couple of minutes later in `Europe/Ljubljana`. It deletes the old profiles, their runs and their unreviewed Review items, and keeps manual searches, saved and dismissed postings and every application. It refuses to run while other AI work is still queued. Edit the plan file to make it yours. Eligible postings with an explicit application email address are prepared one at a time and appear under **Review**. Dossier never guesses an address and never sends a batch: each email needs its own confirmation.

When SearXNG is configured, an otherwise eligible posting without an address triggers a public web search. Dossier reads a small number of result pages, extracts only addresses actually present on those pages, and asks the configured AI model to rank those candidates. It never asks the model to invent an address. Review shows every candidate with its source and confidence; you must choose one before Dossier prepares the application.

To add the private SearXNG service to a production Compose installation, download its small configuration file, enable the profile and give Dossier its internal address:

```bash
mkdir -p docker
curl -fsSL -o docker/searxng-settings.yml https://raw.githubusercontent.com/AienTech/dossier/main/docker/searxng-settings.yml
```

Then add or update these lines in `.env` (keep `ai` in the profile list when Compose also runs your Ollama):

```env
COMPOSE_PROFILES=ai,email-discovery
DOSSIER_SEARXNG_URL=http://searxng:8080
```

SearXNG is not exposed on a host port. It is free software, but it sends the company and role search terms to the external search engines you enable in its configuration.

To connect Gmail:

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and enable **Gmail API**.
2. Configure the OAuth consent screen. While the app is in Testing, add your Gmail address as a test user.
3. Create an OAuth 2.0 **Web application** client. Add `http://localhost:3000/api/gmail/callback` as an authorized redirect URI for local use, or `https://your-dossier-host/api/gmail/callback` in production.
4. Put the matching values in `.env` and restart Dossier:

   ```env
   DOSSIER_PUBLIC_URL=http://localhost:3000
   DOSSIER_GOOGLE_CLIENT_ID=your-client-id
   DOSSIER_GOOGLE_CLIENT_SECRET=your-client-secret
   ```

5. Open **Settings → Automation → Connect Gmail**.

The OAuth grant uses identity plus `gmail.send`; it cannot read the inbox. The refresh token is encrypted with an installation-specific key derived from `DOSSIER_SECRET`, is excluded from exports and must be reconnected after importing onto another install or changing `DOSSIER_SECRET`. If Gmail does not confirm a send before the network times out, Dossier does not retry automatically: check Gmail Sent, then choose **Mark sent** or the warned **Retry send** action.

## Quick apply

**Quick apply** (`/apply`) is for postings you find yourself. Give the posting's link and press **Fetch the posting**, or paste its text. Optionally add the address to send the application to and a note (a referral, why this company). Dossier then reads the posting, matches it against your profile and writes, in one go:

- **What to fix in your CV:** requirements your profile doesn't show and skills not tied to a role, found by code, followed by up to eight concrete suggestions from the AI (what to lead with, what to rewrite, words the posting uses). It never suggests claiming something your profile doesn't have; it says "if you have …, add …" instead.
- **A cover letter** and **a tailored CV**, as for any application.
- **An email** from you to the company, to the address you gave or the one in the posting. Edit it on the page and **Send with Gmail**: the tailored CV and the cover letter go along as PDFs, after you confirm.

Each Quick apply is also a Draft under **Applications**, where the chat can refine it further. A Quick apply goes ahead of the automated search's queued work, so it starts as soon as the AI finishes its current posting. Some job sites build the posting in the browser with JavaScript; Dossier can't fetch those and says so: open the link, copy the posting and paste it.

## Backups and restore

Run these from your Dossier folder (`~/dossier`).

- **Export:** **Settings → Your data → Export** downloads everything (profile, themes, settings, applications with their documents, chat, notes and history) as one JSON file. Your API key is left out unless you tick the box.
- **Import:** importing such a file replaces all data in one step, after saving a backup of what was there to the data directory's `backups` folder.
- **Nightly backups** (on by default) write the same export to `/data/backups` in the app's volume at 03:00 server time, keeping `DOSSIER_BACKUP_RETENTION_DAYS` days of them. Copy them off the server now and then: `docker compose cp app:/data/backups ./backups`.
- **Database dumps:** back up PostgreSQL itself too:

  ```bash
  docker compose exec -T db pg_dump -U dossier -Fc dossier > dossier.dump
  ```

  To restore a dump, stop Dossier, load the dump, and start Dossier again:

  ```bash
  docker compose stop app
  docker compose exec -T db pg_restore --clean --if-exists -U dossier -d dossier < dossier.dump
  docker compose start app
  ```

Keep a copy of `.env` with your backups: saved API keys can't be read without its `DOSSIER_SECRET` (an export with the key included carries it in plain text instead).

## Upgrading

When a new version is out, the sidebar says so, with a link to what's new; Settings → About shows it too. Dossier checks GitHub for it once on each day you use it (switch that off in Settings → About).

Take a backup first (an export, or a database dump). Then, in your Dossier folder:

```bash
docker compose pull
docker compose up -d
```

`latest` is always the newest release. If you've pinned a version with `DOSSIER_IMAGE`, change it to the new one first. When a release's notes say `compose.yml` changed, fetch it again with the `curl` line from [step 3](#3-set-up-the-database).

The new version updates the database on start. Going back to an older version after that isn't supported: restore the backup you took instead.

From 1.4, Dossier sends a usage ping (see [Privacy](#privacy)). If you'd rather it didn't, set `DOSSIER_TELEMETRY=off` before you upgrade to 1.4 or later.

**From 1.0:** Dossier 1.0 took the password itself in `DOSSIER_PASSWORD`; newer versions only take a hash of it, and don't start until it is one. Make the hash with the newer image (`docker run --rm -it ghcr.io/aientech/dossier hash-password`, typing your current password to keep it), put it in `.env`, then pull and start as above. Every browser is signed out once and signs in again with the same password.

## Troubleshooting

`docker compose logs app` shows the app's log (add `-f` to follow it). After changing `.env`, run `docker compose up -d` again.

- **"Dossier didn't start: applying the database migrations failed."** The error above that line says why. `P1001` means the database isn't reachable: check that the `db` container is running (`docker compose ps`). If a migration failed halfway, the database needs repairing before the next start: restore the dump you took before upgrading, or ask for help with the log.
- **"… is not set" or "DOSSIER_SECRET is too short":** set the variable the log names in `.env`.
- **"DOSSIER_PASSWORD must be a hash of your password":** it's set to the password itself, which Dossier 1.0 took. Make a hash with `docker run --rm -it ghcr.io/aientech/dossier hash-password` and set `DOSSIER_PASSWORD` to it.
- **PDFs fail or time out:** Chromium needs memory; give the app at least 768 MB (`compose.yml` gives it 1 GB). Fonts are bundled with Dossier, so documents look the same everywhere; a custom document language in a script Dossier has no font for may show empty boxes.
- **The AI times out:** local models on a CPU are slow. Try a smaller model, or raise `DOSSIER_AI_TIMEOUT_SECONDS`. **Test connection** in Settings shows whether Dossier reaches the server at all; inside Docker, `localhost` isn't the server.
- **An import fails with "413" or "Request Entity Too Large":** the reverse proxy's upload limit is below 10 MB. Caddy has none by default; with nginx, set `client_max_body_size 12m;`.
- **"That file is over 10 MB":** imports are capped at 10 MB, roughly 500 applications. Raising the cap means changing two settings in the code (see [Import size limit](DEVELOPMENT.md#import-size-limit)).
- **"Too many attempts":** after five wrong passwords in a minute, sign-in pauses for 30 seconds, then longer each time, up to 15 minutes. The count is kept in the database, so restarting doesn't reset it: wait it out.
- **Forgot the password:** make a hash of a new one with `hash-password` (see [step 4](#4-set-up-the-app)) and set it as `DOSSIER_PASSWORD` in `.env`.
- **Is it up?** `/api/health` answers `{"status":"ok"}` when the app and its database are fine, and 503 when the database isn't reachable.

## Privacy

Everything you enter is kept in your PostgreSQL database and data directory. [PRIVACY.md](PRIVACY.md) has the details: what's kept and for how long, what deleting removes, everything that leaves your server and who receives it, and a note on the GDPR.

- **AI:** with a local model, your profile, postings and documents never leave your server. A hosted provider receives what each task needs: the posting, your profile without contact details (no email, phone, address, date of birth or links), what you tell it about the application, and, when you refine, the drafts and your chat messages, though never a letter's sender or signature. Email discovery sends only the company, role and public address evidence to the configured model. Importing a resume sends its whole text, contact details included; the import page says so first. The notes you keep on an application are never sent. How long the provider keeps what it receives, and where it processes it, depend on its terms and your account.
- **Task data:** what an AI task was given and wrote (a posting being read, a resume's text, drafts you didn't turn into an application) is deleted after 24 hours, or as long as Settings → Your data says. Deleting an application deletes its task data at once.
- **Usage ping:** on each day you use Dossier, your server sends `telemetry.dossier.aien.me` a random install ID and the version number, once, so the project knows how many installs are in use and how often. Nothing else is sent. Set `DOSSIER_TELEMETRY=off` to stop it. [PRIVACY.md](PRIVACY.md#usage-ping) says what the receiver keeps, for how long, and how to have it deleted.
- **Update check:** once on each day you use Dossier, and when you press **Check for updates**, your server asks GitHub for the latest release, and sends nothing about you or your install. Switch the daily check off in Settings → About.
- **When you ask for it:** manual Find jobs, off until you choose a source, sends that source what you search for and nothing from your profile. Enabled automatic profiles query JSearch plus the public Remote OK, Remotive, We Work Remotely, Himalayas, Jobicy and Arbeitnow APIs; they receive the profile's keywords and country, never profile data, and the feeds are filtered locally. **Fetch** asks a job site for a posting's page, from your server. Email discovery sends the company and role to SearXNG's enabled engines and fetches result pages from your server.
- **Cold outreach:** off until you acknowledge the compliance notice and enable it. Campaign keywords, with the countries and cities in the campaign's regions, are sent to the search engines enabled in your private SearXNG. Your server then reads up to six robots.txt-compliant pages on each candidate company's public site. The configured AI model receives those public excerpts and a profile without contact details to score fit, rank only email addresses found verbatim, draft one email and tailor a CV. Nothing is sent until you approve a lead. Gmail receives the approved recipient, message and CV through the `gmail.send` scope; Dossier does not read replies, track opens or send follow-ups. Public availability of an address is not, by itself, permission to contact it in every country; consider GDPR legitimate interest and applicable local ePrivacy rules.
- **No other tracking or analytics:** Dossier loads nothing from other sites (its Content-Security-Policy forbids it, and the ping comes from your server, not your browser), and Next.js telemetry is off in the image.

## Known limitations

- **Desktop only:** made for a laptop or desktop browser, not for phones.
- **Single user:** one password and one profile; there are no accounts.
- **English interface:** documents can be written in other languages, but the app itself is in English.
- **One instance:** run a single copy of the app per database. The nightly backups, the AI job queue and the PDF browser live inside the app's process.
- **Small local models are slow and less careful:** with a 3B model such as `qwen2.5:3b`, each automated posting takes about half a minute and a Quick apply one to two minutes, and a large daily run can keep the AI busy for an hour or more. They also make more mistakes (a posting's language, for one, is now cross-checked by code); a 7B+ or hosted model writes better documents.
- **Script-built job pages:** postings that a site loads in the browser can't be fetched from a link; paste their text instead.
- **Restarts:** restarting the app marks queued and running AI work as failed; retry it from Review or the page it came from.

## Performance and sizing

Measured on 28 September 2026 with the production build in a container limited to 2 vCPUs and 1 GB:

- **PDFs:** the base resume renders in about 0.25 s, or 1 s when Chromium has to start first (it closes after five idle minutes). Two render at a time and the rest queue: six requested at once are done in 1.4 s. Dossier used at most about 520 MB, Chromium included, so give the container at least 768 MB.
- **Screens:** with ten times the demo data (90 applications), the dashboard and the applications list answer in 20–90 ms, and every query takes under a millisecond. With 900 applications they take up to about 0.2 s, mostly rendering; the tables are indexed for the queries they get.
- **Interactions** (changing a status, moving a card, switching tabs, opening an editor, typing, picking a theme) respond within 32 ms, and within about 100 ms on a CPU four times slower.

## Security

What protects your data, how to run Dossier safely and how to report a problem: see [SECURITY.md](SECURITY.md).

## What this fork adds

Compared with [Dossier 1.5.0](https://github.com/AienTech/dossier), this fork adds:

- **Automation:** daily search profiles across seven sources (Himalayas, Jobicy and Arbeitnow added to JSearch, Remote OK, Remotive and We Work Remotely), with per-source stats, failure isolation, cross-profile de-duplication, a fair 30-candidate quota and quoted `OR` keyword queries, plus a script that sets up 35 city profiles.
- **Review:** an approval queue for AI-prepared applications, with a live progress bar, rich filters, bulk dismiss, "I applied manually" and public application-email discovery through a private SearXNG.
- **Gmail:** sending an application with its CV and cover letter through the `gmail.send` scope, one confirmed email at a time.
- **Quick apply:** CV advice, a cover letter, a tailored CV and a ready email for any posting you paste or link.
- **Refine with AI answers questions:** the chat sees the whole posting and answers application-form questions in your voice, with placeholders for what your profile doesn't say.
- **Better drafts from small models:** application emails are written from the candidate to the company, the posting's language is checked by code, and fetched pages that aren't a posting are refused.
- **Cold outreach (opt-in):** company discovery and drafted emails for unsolicited applications, each approved by you.

## Development

Working on Dossier itself: see [DEVELOPMENT.md](DEVELOPMENT.md).

## License

Dossier is free software under the [GNU Affero General Public License v3.0](LICENSE). You may use, change and share it; if you run a changed version for others over a network, you must offer them its source code.
