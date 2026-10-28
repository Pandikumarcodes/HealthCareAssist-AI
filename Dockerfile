FROM node:24-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_BASE_URL=""
RUN npm run build

FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app/ ./app/
COPY backend/migrations/ ./migrations/
COPY backend/gunicorn.conf.py ./
COPY --from=frontend /build/frontend/dist /app/frontend/dist
RUN useradd --create-home appuser && mkdir -p instance && chown appuser:appuser instance
USER appuser
CMD ["gunicorn", "--config", "gunicorn.conf.py", "app:create_app()"]
