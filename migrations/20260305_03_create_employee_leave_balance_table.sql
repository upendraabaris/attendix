-- 3) Create employee leave balances
CREATE TABLE IF NOT EXISTS public.employee_leave_balance (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type VARCHAR(20) NOT NULL,
  used_days NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (used_days >= 0),
  balance NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_leave_balance_leave_type_check
    CHECK (leave_type IN ('sick', 'vacation', 'personal', 'other', 'earned')),
  CONSTRAINT employee_leave_balance_unique_emp_type UNIQUE (employee_id, leave_type)
);

CREATE INDEX IF NOT EXISTS idx_employee_leave_balance_employee
ON public.employee_leave_balance (employee_id);
