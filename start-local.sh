#!/bin/bash
# -----------------------------------------------------------
# Primordia Project — Local Server Starter
# -----------------------------------------------------------
# This script loads the .env file and starts the Express server.
# -----------------------------------------------------------
set -e
echo "✅ Reading configuration from .env file..."
export $(grep -v '^#' .env | xargs)

echo "🚀 Starting the local server..."
npm start
