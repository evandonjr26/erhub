# Motion Studio on Render Free: CPU-only Whisper tiny + FFmpeg + FastAPI
# Independent deployment; never modifies the Mesa de Corte service.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg fonts-dejavu-core libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    WHISPER_MODEL=tiny WHISPER_CPU_THREADS=1 \
    WHISPER_RELEASE_AFTER_TRANSCRIBE=true \
    OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MALLOC_ARENA_MAX=2 \
    MAX_AUDIO_MB=30 MAX_DURATION_SECONDS=60 \
    ENABLE_OLLAMA=false MOTION_STORAGE=/motion-studio/storage
WORKDIR /motion-studio
COPY app-data.b64 bootstrap.py ./
RUN python bootstrap.py && python -m pip install --no-cache-dir -r requirements.txt \
    && mkdir -p /motion-studio/storage \
    && rm -f app-data.b64
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.server:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers"]
