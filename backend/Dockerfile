# ----------------------------
# Stage 1: Base environment
# ----------------------------
FROM python:3.11-slim AS base

# Environment variables for reliability
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH="/usr/local/bin:$PATH"

# Set working directory
WORKDIR /app

# ----------------------------
# Stage 2: Install dependencies
# ----------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libffi-dev \
    libssl-dev \
 && rm -rf /var/lib/apt/lists/*

# Copy and install dependencies first (better build cache)
COPY requirements.txt .

RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ----------------------------
# Stage 3: Copy app and run
# ----------------------------
COPY . .

EXPOSE 6311

# Use production-ready Uvicorn command
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "6311"]
