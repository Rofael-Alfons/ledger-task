#!/bin/bash

echo "🚀 Setting up Wallet Service..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "✅ .env file created"
else
    echo "✅ .env file already exists"
fi

# Start PostgreSQL with Docker
echo "🐳 Starting PostgreSQL containers..."
docker-compose up -d postgres postgres-test

echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 5

# Check PostgreSQL health
docker-compose ps postgres

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Run 'npm run start:dev' to start the application"
echo "  2. Run 'npm run test' to run unit tests"
echo "  3. Run 'npm run test:e2e' to run E2E tests"
echo ""
echo "API will be available at: http://localhost:3000"
