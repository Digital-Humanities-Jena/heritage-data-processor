FROM python:3.11-slim

LABEL maintainer="your-email@example.com"
LABEL description="HDP Components API Service"

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=app.main:create_app

RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

RUN mkdir -p /app/data

EXPOSE 8599

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8599/health || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:8599", "--workers", "2", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "app.main:create_app()"]
