#!/usr/bin/env bash
echo "--> Applying the final fix to docker-compose.override.yml..."
cat > docker-compose.override.yml <<'YAML'
services:
  primordia:
    volumes:
      # This enables live code reloading for the main service.
      - ./src:/app/src:ro

  local-launcher:
    build:
      context: .
      dockerfile: Dockerfile.local-launcher
    image: primordia/local-launcher:cli
    container_name: local-launcher
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./:/app:rw
    working_dir: /app
    environment:
      # This is the critical networking fix.
      DOCKER_NETWORK: primordia_default
      
      # Other required variables
      PROJECT_ID: ticktalk-472521
      PUBSUB_EMULATOR_HOST: pubsub:8083
      STORAGE_EMULATOR_HOST: http://gcs:4443
      WORKSPACE_BUCKET: primordia-bucket
      LOCAL_EVENTS_TOPIC: primordia-builds
      LOCAL_LAUNCHER_SUB: primordia-local-launcher-sub
    command: ["node","local-launcher.js"]
    depends_on:
      - pubsub
      - gcs
    networks:
      - default
YAML
echo "--> docker-compose.override.yml has been fixed."
