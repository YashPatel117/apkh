# AI-Powered Personal Knowledge Hub

This repository contains the full local project setup for:

- `apkh-web` - Next.js frontend
- `apkh-api` - NestJS backend
- `apkh-storage` - file storage service
- `apkh-search` - Python search, ingestion, embeddings, OCR, and summary service

## Local Setup Order

Follow the steps in this exact order on Windows.

## Prerequisites

Install these first:

- Node.js
- Python 3
- npm
- Windows Terminal

No OCR engine needs to be installed. Images and scanned PDF pages are read by each user's active AI model (the API key and model set in Profile settings), which transcribes any text and describes the image so it can be searched like note text. The model must accept images; current Gemini, OpenAI and Claude chat models do, but older text-only ones such as `gpt-3.5-turbo` do not.

The model list in Profile settings is not hardcoded: once a key is entered it is fetched live from the provider (Gemini, OpenAI or Anthropic), so new models appear and retired ones disappear automatically. A saved config can switch to another model with its pencil button without re-entering the key.

## Step 1: Create `apkh-search/.env`

Copy [`apkh-search/.env.example`](apkh-search/.env.example) to `apkh-search/.env` and set `JWT_SECRET` to the same value used in `apkh-api`.

## Step 2: Install All Project Dependencies

Run this from the repository root:

```bat
setup-all.bat
```

What it does:

- runs `npm install` in `apkh-api`
- runs `npm install` in `apkh-storage`
- runs `npm install` in `apkh-web`
- creates `apkh-search/.venv` if needed
- upgrades `pip`
- installs Python packages from `apkh-search/requirements.txt`

## Step 3: Start All Services

Run this from the repository root:

```bat
start-all.bat
```

This opens Windows Terminal tabs for:

- API
- Storage
- Web
- Search

## Project URLs

After startup, the local services are expected at:

- Storage: `http://localhost:3001`
- Web: `http://localhost:3002`
- Search: `http://localhost:8000`

The API port depends on the Nest app configuration used in `apkh-api`.

## First-Time Setup Summary

For a fresh clone, the full flow is:

1. Create `apkh-search/.env` from `.env.example`
2. Run `setup-all.bat`
3. Run `start-all.bat`

## Notes

- `apkh-search/.env` is ignored by git, so each machine should create its own copy.
- If `start-all.bat` does not open tabs, make sure `wt` (Windows Terminal) is installed and available.

## macOS

For macOS, use this flow instead.

### Step 1: Install prerequisites

Install Homebrew first if it is not already installed, then run:

```bash
brew install node python
```

### Step 2: Create `apkh-search/.env`

```bash
cp apkh-search/.env.example apkh-search/.env
```

Set `JWT_SECRET` to the same value used in `apkh-api`.

### Step 3: Install all dependencies

Run these commands from the repository root:

```bash
cd apkh-api && npm install
cd ../apkh-storage && npm install
cd ../apkh-web && npm install
cd ../apkh-search && python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 4: Start all services

Open separate Terminal tabs or windows and run:

```bash
cd apkh-api && npm run start:dev
cd apkh-storage && npm start
cd apkh-web && npm run dev
cd apkh-search && .venv/bin/python main.py
```

### macOS Summary

1. Install `node` and `python` with Homebrew
2. Create `apkh-search/.env` from `.env.example`
3. Install dependencies for all projects
4. Start each service in its own terminal
