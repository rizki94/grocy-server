DO $$
DECLARE
    hq_id uuid;
    branch_table text;
    constraint_name text;
BEGIN
    SELECT "id" INTO hq_id
    FROM "branches"
    WHERE "is_hq" = true
    LIMIT 1;

    IF hq_id IS NULL THEN
        SELECT "id" INTO hq_id
        FROM "branches"
        ORDER BY "created_at"
        LIMIT 1;
    END IF;

    IF hq_id IS NULL THEN
        INSERT INTO "branches" ("code", "name", "is_hq", "is_active")
        VALUES ('HQ', 'Headquarters', true, true)
        RETURNING "id" INTO hq_id;
    END IF;

    FOREACH branch_table IN ARRAY ARRAY[
        'bank_reconciliations',
        'deliveries',
        'drivers',
        'expenses',
        'incomes',
        'journals',
        'open_invoices',
        'payments',
        'period_closings',
        'pos_sessions',
        'product_branches',
        'product_detail_prices',
        'route_groups',
        'stock_opnames',
        'transactions',
        'trucks',
        'users',
        'warehouses'
    ]
    LOOP
        IF to_regclass(format('public.%I', branch_table)) IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                    AND table_name = branch_table
                    AND column_name = 'branch_id'
            ) THEN
                EXECUTE format(
                    'ALTER TABLE public.%I ADD COLUMN branch_id uuid REFERENCES public.branches(id)',
                    branch_table
                );
            END IF;
            EXECUTE format(
                'UPDATE public.%I SET branch_id = $1 WHERE branch_id IS NULL',
                branch_table
            ) USING hq_id;
            EXECUTE format(
                'ALTER TABLE public.%I ALTER COLUMN branch_id SET NOT NULL',
                branch_table
            );
        END IF;
    END LOOP;

    IF to_regclass('public.period_closings') IS NOT NULL THEN
        FOR constraint_name IN
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_attribute a
                ON a.attrelid = c.conrelid
                AND a.attnum = ANY(c.conkey)
            WHERE c.conrelid = 'public.period_closings'::regclass
                AND c.contype = 'f'
                AND a.attname = 'branch_id'
        LOOP
            EXECUTE format(
                'ALTER TABLE public.period_closings DROP CONSTRAINT %I',
                constraint_name
            );
        END LOOP;

        ALTER TABLE public.period_closings
            ADD CONSTRAINT period_closings_branch_id_branches_id_fk
            FOREIGN KEY (branch_id) REFERENCES public.branches(id);
    END IF;
END $$;
