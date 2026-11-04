FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY bootstrap.mjs app-data.b64 manual-sync-apply.mjs simple-sync.js simple-sync.css bottom-actions.js bottom-actions.css marker-wave.js marker-wave.css ./
RUN node bootstrap.mjs && node manual-sync-apply.mjs \
    && printf '\n' >> public/app.js && cat simple-sync.js >> public/app.js \
    && printf '\n' >> public/styles.css && cat simple-sync.css >> public/styles.css \
    && printf '\n' >> public/app.js && cat bottom-actions.js >> public/app.js \
    && printf '\n' >> public/styles.css && cat bottom-actions.css >> public/styles.css \
    && printf '\n' >> public/app.js && cat marker-wave.js >> public/app.js \
    && printf '\n' >> public/styles.css && cat marker-wave.css >> public/styles.css \
    && node --check public/app.js && node --check server.mjs \
    && rm bootstrap.mjs app-data.b64 manual-sync-apply.mjs simple-sync.js simple-sync.css bottom-actions.js bottom-actions.css marker-wave.js marker-wave.css
ENV HOST=0.0.0.0
EXPOSE 4173
CMD ["node","server.mjs"]
