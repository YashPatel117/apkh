# Deploying (free tier demo)

| Piece | Where |
|---|---|
| `apkh-web` | Vercel (Hobby) |
| `apkh-api` + `apkh-search` + `apkh-storage` | One Hugging Face Docker Space (`deploy/hf-space/`) |
| Database + attachment files | MongoDB Atlas M0 (files in GridFS) |
| Built-in AI | Off: users add their own API key on the Profile page |

Inside the Space only the API is public (port 7860). Search (8000) and storage (3001) listen on localhost and the API reaches them there.

## 1. MongoDB Atlas

1. Use a separate database for the demo, e.g. `.../apkh-demo?retryWrites=true&w=majority`. A new `ENCRYPTION_SECRET` can't decrypt API keys saved with your dev secret, so starting clean is simpler.
2. Network Access → allow `0.0.0.0/0` (Spaces have no fixed IP).
3. Create the vector index once from your machine:
   `cd apkh-api && MONGODB_URI="<demo uri>" npm run search:vector-index`

## 2. Hugging Face Space (API + search + storage)

1. https://huggingface.co/new-space → SDK **Docker**, hardware **CPU basic (free)**, visibility **Public**. (A private Space can't be called from the browser.)
2. Space → Settings → **Variables and secrets**:

   | Name | Type | Value |
   |---|---|---|
   | `MONGODB_URI` | secret | demo database URI |
   | `JWT_SECRET` | secret | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
   | `ENCRYPTION_SECRET` | secret | another random value like the above |
   | `CORS_ORIGINS` | variable | `https://<your-app>.vercel.app` |
   | `BUILTIN_AI` | variable | `off` |
   | `FIREBASE_PROJECT_ID` | variable | your Firebase project ID |
   | `ATLAS_VECTOR_INDEX` | variable | `chunk_vectors` |

3. Commit your changes, then from Git Bash:

   ```bash
   pip install -U huggingface_hub
   hf auth login                    # token with write access
   deploy/hf-space/push.sh <hf-username>/<space-name>
   ```

   The script uploads only committed files of the three backend folders, plus the Dockerfile. Run it again to redeploy.
4. Wait for the build (Logs tab, ~5–10 min the first time). Check `https://<hf-username>-<space-name>.hf.space/api` shows Swagger.

## 3. Vercel (web)

Root directory `apkh-web`, with these environment variables:

```
NEXT_PUBLIC_API_URL=https://<hf-username>-<space-name>.hf.space
NEXT_PUBLIC_BUILTIN_AI_ENABLED=false
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

`NEXT_PUBLIC_*` values are baked in at build time: redeploy after changing them.

## 4. Firebase

Authentication → Settings → **Authorized domains** → add `<your-app>.vercel.app`, or "Continue with Google" fails.

## Limits to know

- A free Space **sleeps after ~48 h without traffic**; the first request wakes it (about a minute). Background indexing resumes on wake.
- Atlas M0 has **512 MB in total**, shared by notes, the search index and attachment files.
- A public Space shows its files (the code); secrets set in Settings stay hidden.
