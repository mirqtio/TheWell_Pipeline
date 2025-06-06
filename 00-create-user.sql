-- 00-create-user.sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'thewell_user') THEN
        CREATE ROLE thewell_user WITH LOGIN PASSWORD 'SuperSecurePwd123!';
        RAISE NOTICE 'Role % created by 00-create-user.sql.', 'thewell_user';
    ELSE
        RAISE NOTICE 'Role % already existed when 00-create-user.sql ran. Ensuring grants.', 'thewell_user';
        -- The main postgres entrypoint likely created the user with the correct password.
        -- If we wanted to be absolutely sure about the password:
        -- ALTER ROLE thewell_user WITH LOGIN PASSWORD 'SuperSecurePwd123!';
    END IF;
END
$$;

-- Grant privileges on the database
-- These grants will apply whether the user was just created or already existed.
GRANT ALL PRIVILEGES ON DATABASE thewell TO thewell_user;

-- Grant privileges on the public schema
GRANT CREATE ON SCHEMA public TO thewell_user;

-- A final notice to confirm grants were attempted
DO $$ BEGIN RAISE NOTICE 'Privileges grant attempt completed for thewell_user by 00-create-user.sql.'; END $$;
