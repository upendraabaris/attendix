-- 2) Create organization-level leave policies
CREATE TABLE IF NOT EXISTS public.leave_policies (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  leave_type VARCHAR(20) NOT NULL,
  yearly_limit INTEGER NOT NULL DEFAULT 0 CHECK (yearly_limit >= 0),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  earned_days_required INTEGER CHECK (earned_days_required IS NULL OR earned_days_required > 0),
  earned_leave_award NUMERIC(10,2) CHECK (earned_leave_award IS NULL OR earned_leave_award > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leave_policies_leave_type_check
    CHECK (leave_type IN ('sick', 'vacation', 'personal', 'other', 'earned')),
  CONSTRAINT leave_policies_unique_org_type UNIQUE (organization_id, leave_type)
);

CREATE INDEX IF NOT EXISTS idx_leave_policies_org
ON public.leave_policies (organization_id);
