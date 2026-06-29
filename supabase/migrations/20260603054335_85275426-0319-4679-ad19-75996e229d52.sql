
-- Table to store Monday OAuth users
CREATE TABLE public.monday_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monday_user_id TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  photo_url TEXT,
  access_token TEXT NOT NULL,
  token_type TEXT,
  scope TEXT,
  account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.monday_users TO service_role;
-- No anon/authenticated grants: only the server (service role) reads/writes this table.

ALTER TABLE public.monday_users ENABLE ROW LEVEL SECURITY;
-- No policies: clients cannot read tokens. Server uses service role to bypass RLS.

CREATE TRIGGER monday_users_touch_updated_at
BEFORE UPDATE ON public.monday_users
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Track who created each spec (Monday user id, not Supabase auth user)
ALTER TABLE public.specs
ADD COLUMN created_by_monday_user_id TEXT;
