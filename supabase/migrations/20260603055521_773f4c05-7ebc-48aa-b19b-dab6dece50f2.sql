ALTER TABLE public.monday_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny all client access to monday_users"
ON public.monday_users
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

GRANT ALL ON public.monday_users TO service_role;