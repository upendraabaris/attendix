-- 4) Extend existing function with policy-aware validation while keeping
-- existing signature and return shape unchanged.
CREATE OR REPLACE FUNCTION public.create_leave_request(
  p_employee_id integer,
  p_type character varying,
  p_start_date date,
  p_end_date date,
  p_reason text
)
RETURNS TABLE(
  id integer,
  employee_id integer,
  type character varying,
  start_date date,
  end_date date,
  reason text,
  status character varying,
  created_at timestamp without time zone
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_requested_days integer;
  v_org_id integer;
  v_policy leave_policies%ROWTYPE;
  v_used_days numeric(10,2);
  v_available_earned numeric(10,2);
BEGIN
  -- Existing validation
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Start date cannot be after end date';
  END IF;

  IF p_type NOT IN ('sick', 'vacation', 'personal', 'other', 'earned') THEN
    RAISE EXCEPTION 'Invalid leave type: %', p_type;
  END IF;

  -- Existing overlap validation
  IF EXISTS (
    SELECT 1
    FROM leave_requests lr
    WHERE lr.employee_id = p_employee_id
      AND lr.status != 'rejected'
      AND (
        (p_start_date BETWEEN lr.start_date AND lr.end_date) OR
        (p_end_date BETWEEN lr.start_date AND lr.end_date) OR
        (lr.start_date BETWEEN p_start_date AND p_end_date) OR
        (lr.end_date BETWEEN p_start_date AND p_end_date)
      )
  ) THEN
    RAISE EXCEPTION 'Overlapping leave request exists for this period';
  END IF;

  SELECT e.organization_id
  INTO v_org_id
  FROM employees e
  WHERE e.id = p_employee_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Employee organization not found';
  END IF;

  v_requested_days := (p_end_date - p_start_date + 1);

  SELECT lp.*
  INTO v_policy
  FROM leave_policies lp
  WHERE lp.organization_id = v_org_id
    AND lp.leave_type = p_type
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave policy is not configured for type "%" in your organization', p_type;
  END IF;

  IF v_policy.is_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Leave type "%" is currently disabled by admin policy', p_type;
  END IF;

  IF p_type = 'earned' THEN
    SELECT COALESCE(elb.balance, 0)
    INTO v_available_earned
    FROM employee_leave_balance elb
    WHERE elb.employee_id = p_employee_id
      AND elb.leave_type = 'earned'
    LIMIT 1;

    SELECT COALESCE(SUM(lr.end_date - lr.start_date + 1), 0)
    INTO v_used_days
    FROM leave_requests lr
    WHERE lr.employee_id = p_employee_id
      AND lr.type = 'earned'
      AND lr.status != 'rejected'
      AND EXTRACT(YEAR FROM lr.start_date) = EXTRACT(YEAR FROM p_start_date);

    IF (v_available_earned - v_used_days) < v_requested_days THEN
      RAISE EXCEPTION 'Insufficient earned leave balance';
    END IF;
  ELSE
    SELECT COALESCE(SUM(
      LEAST(lr.end_date, make_date(EXTRACT(YEAR FROM p_start_date)::integer, 12, 31))
      - GREATEST(lr.start_date, make_date(EXTRACT(YEAR FROM p_start_date)::integer, 1, 1))
      + 1
    ), 0)
    INTO v_used_days
    FROM leave_requests lr
    WHERE lr.employee_id = p_employee_id
      AND lr.type = p_type
      AND lr.status != 'rejected'
      AND lr.start_date <= make_date(EXTRACT(YEAR FROM p_start_date)::integer, 12, 31)
      AND lr.end_date >= make_date(EXTRACT(YEAR FROM p_start_date)::integer, 1, 1);

    IF (v_used_days + v_requested_days) > v_policy.yearly_limit THEN
      RAISE EXCEPTION 'Yearly leave limit exceeded for type "%"', p_type;
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO leave_requests (employee_id, type, start_date, end_date, reason)
  VALUES (p_employee_id, p_type, p_start_date, p_end_date, p_reason)
  RETURNING
    leave_requests.id,
    leave_requests.employee_id,
    leave_requests.type,
    leave_requests.start_date,
    leave_requests.end_date,
    leave_requests.reason,
    leave_requests.status,
    leave_requests.created_at;
END;
$$;
