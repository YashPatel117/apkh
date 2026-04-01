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

## Step 1: Install Tesseract OCR

OCR is used by `apkh-search` for image text extraction and OCR fallback on scanned PDFs.

If the installer exists in the repo root, run:

```bat
tesseract-ocr-w64-setup-5.5.0.20241111.exe
```

After installation, note the full path to `tesseract.exe`.

Typical Windows path:

```text
C:\Program Files\Tesseract-OCR\tesseract.exe
```

## Step 2: Add Tesseract Path to `apkh-search/.env`

Create or update this file:

[`apkh-search/.env`](/d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-search/.env)

Add:

```env
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

If you installed Tesseract in a different folder, use that path instead.

You can also start from:

[`apkh-search/.env`](/d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-search/.env)

## Step 3: Install All Project Dependencies

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

## Step 4: Start All Services

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

1. Install Tesseract OCR
2. Put the `tesseract.exe` path into `apkh-search/.env`
3. Run `setup-all.bat`
4. Run `start-all.bat`

## Notes

- `apkh-search/.env` is ignored by git, so each machine should create its own copy.
- If Tesseract is already available on system `PATH`, keeping `TESSERACT_CMD` set is still fine.
- If `start-all.bat` does not open tabs, make sure `wt` (Windows Terminal) is installed and available.

## macOS

For macOS, use this flow instead.

### Step 1: Install prerequisites

Install Homebrew first if it is not already installed, then run:

```bash
brew install node python tesseract
```

### Step 2: Find the Tesseract path

Run:

```bash
which tesseract
```

Typical output:

Apple Silicon:

```text
/opt/homebrew/bin/tesseract
```

Intel Mac:

```text
/usr/local/bin/tesseract
```

### Step 3: Add the path to `apkh-search/.env`

Create or update:

[`apkh-search/.env`](/d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-search/.env)

Example:

```env
TESSERACT_CMD=/opt/homebrew/bin/tesseract
```

### Step 4: Install all dependencies

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

### Step 5: Start all services

Open separate Terminal tabs or windows and run:

```bash
cd apkh-api && npm run start:dev
cd apkh-storage && npm start
cd apkh-web && npm run dev
cd apkh-search && .venv/bin/python main.py
```

### macOS Summary

1. Install `node`, `python`, and `tesseract` with Homebrew
2. Put the `tesseract` path into `apkh-search/.env`
3. Install dependencies for all projects
4. Start each service in its own terminal
