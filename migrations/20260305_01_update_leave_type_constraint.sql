-- 1) Extend leave type constraint to include "earned"
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname
  INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'leave_requests'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%type%'
    AND nsp.nspname = 'public'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.leave_requests DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.leave_requests
ADD CONSTRAINT leave_requests_type_check
CHECK (type IN ('sick', 'vacation', 'personal', 'other', 'earned'));
