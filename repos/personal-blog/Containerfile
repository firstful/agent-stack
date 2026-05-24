# Containerized build for agent-stack deployment
FROM docker.io/library/node:22 AS build

ARG SITE_URL=https://blogpreview.ffilt.us/

RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/venv/bin:$PATH"

COPY package*.json ./
RUN npm ci

COPY . .
RUN SITE_URL=$SITE_URL npm run build:preview

FROM docker.io/library/python:3.11-slim
WORKDIR /app
COPY --from=build /app/site /app/site
ENV PORT=8000
EXPOSE 8000
CMD python3 -m http.server 8000 --directory /app/site
