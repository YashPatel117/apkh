# apkh-api, apkh-search and apkh-storage in one container for a Hugging Face
# Docker Space. Only the API is public (port 7860); search and storage listen
# on localhost. Built from the folder deploy/hf-space/push.sh stages.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir /app /opt/venv \
 && chown node:node /app /opt/venv

# Spaces run the container as uid 1000, which is the image's "node" user
USER node
WORKDIR /app

# apkh-search
COPY --chown=node:node apkh-search/requirements.txt apkh-search/
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r apkh-search/requirements.txt
ENV TIKTOKEN_CACHE_DIR=/app/.tiktoken
RUN /opt/venv/bin/python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"
COPY --chown=node:node apkh-search apkh-search

# apkh-api
COPY --chown=node:node apkh-api/package*.json apkh-api/
RUN cd apkh-api && npm ci
COPY --chown=node:node apkh-api apkh-api
RUN cd apkh-api && npm run build && npm prune --omit=dev

# apkh-storage
COPY --chown=node:node apkh-storage/package*.json apkh-storage/
RUN cd apkh-storage && npm ci --omit=dev
COPY --chown=node:node apkh-storage apkh-storage

COPY --chown=node:node start.sh .

ENV NODE_ENV=production
EXPOSE 7860
CMD ["bash", "start.sh"]
