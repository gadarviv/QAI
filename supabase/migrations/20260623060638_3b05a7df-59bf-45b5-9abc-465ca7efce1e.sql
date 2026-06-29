CREATE TABLE public.system_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_catalog TO authenticated;
GRANT ALL ON public.system_catalog TO service_role;

ALTER TABLE public.system_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read catalog"
  ON public.system_catalog FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage catalog"
  ON public.system_catalog FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));