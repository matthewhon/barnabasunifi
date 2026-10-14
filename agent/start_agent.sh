#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "======================================================="
echo "          UnFi-PCO Agent Docker Launcher"
echo "======================================================="
echo ""

# Ensure service-account.json exists as a file so Docker mounts it properly
if [ ! -f "service-account.json" ]; then
    echo "{}" > "service-account.json"
fi

# Ensure .env exists as a file
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp ".env.example" ".env"
    else
        touch ".env"
    fi
fi

# Ensure data directory exists for offline cache
mkdir -p data

echo "Building and launching container..."
docker compose up -d --build

echo ""
echo "======================================================="
echo "  SUCCESS! UnFi-PCO Agent is running."
echo ""
echo "  Open your web browser to configure the agent:"
echo "  --> http://localhost:8080"
echo "======================================================="
echo ""
echo "Streaming logs (Press Ctrl+C to stop viewing logs):"
echo ""
docker compose logs -f
