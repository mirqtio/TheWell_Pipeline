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
