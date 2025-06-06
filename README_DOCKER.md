# TheWell Pipeline Project

This project is a data pipeline.

## Database Migrations

Database migrations are managed using SQL scripts located in `src/database/migrations/`.

To run migrations, use the `npm run db:migrate` command.

### Important Notes

*   **Migration `0004_consolidate_visibility_schema.sql`**: 
    There's a known behavior where the `ALTER TABLE documents DROP COLUMN visibility;` command within this migration script might not always execute automatically, even if the column exists. If you find the `visibility` column still present on the `documents` table after this migration has been applied, you may need to drop it manually using a SQL client:
    ```sql
    ALTER TABLE documents DROP COLUMN IF EXISTS visibility;
    ```
    This situation was observed during development and its exact cause for not dropping automatically in all scenarios within the script is under investigation. However, manual removal has been confirmed to work without adverse effects on the schema consolidation performed by the rest of the migration.

## Docker Deployment

For quick deployment to Docker Desktop:

```bash
# Run the deployment script
./scripts/deploy-docker.sh
```

For detailed instructions, see [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

## Services

When running in Docker, the following services are available:

- **API**: http://localhost:3000
- **API Documentation**: http://localhost:3000/api-docs
- **Grafana Dashboard**: http://localhost:3001
- **Prometheus**: http://localhost:9090

## Quick Start

1. **Install Docker Desktop**
2. **Configure environment**:
   ```bash
   cp .env.production .env.production.local
   # Edit .env.production.local with your API keys
   ```
3. **Deploy**:
   ```bash
   ./scripts/deploy-docker.sh
   ```

## Development

For local development without Docker:

```bash
# Install dependencies
npm install

# Setup database
npm run db:setup

# Run development server
npm run dev
```

## Testing

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e
```