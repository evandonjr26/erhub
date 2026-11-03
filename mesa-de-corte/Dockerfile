FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY bootstrap.mjs app-data.b64 ./
RUN node bootstrap.mjs && rm bootstrap.mjs app-data.b64
ENV HOST=0.0.0.0
EXPOSE 4173
CMD ["node","server.mjs"]
