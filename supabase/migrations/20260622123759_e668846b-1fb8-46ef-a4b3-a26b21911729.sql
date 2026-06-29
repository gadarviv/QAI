
-- 1. profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. roles enum & table
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. has_role security definer function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 4. systems table
CREATE TABLE public.systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systems TO authenticated;
GRANT ALL ON public.systems TO service_role;
ALTER TABLE public.systems ENABLE ROW LEVEL SECURITY;

-- 5. user_systems mapping
CREATE TABLE public.user_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, system_id)
);
GRANT SELECT, INSERT, DELETE ON public.user_systems TO authenticated;
GRANT ALL ON public.user_systems TO service_role;
ALTER TABLE public.user_systems ENABLE ROW LEVEL SECURITY;

-- helper: user has access to a system
CREATE OR REPLACE FUNCTION public.user_has_system(_user_id UUID, _system_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_systems
    WHERE user_id = _user_id AND system_id = _system_id
  )
$$;

-- 6. add system_id to specs
ALTER TABLE public.specs ADD COLUMN system_id UUID REFERENCES public.systems(id) ON DELETE SET NULL;

-- 7. profiles policies
CREATE POLICY "users read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "admins manage profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 8. user_roles policies
CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- 9. systems policies
CREATE POLICY "authenticated read systems" ON public.systems
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage systems" ON public.systems
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 10. user_systems policies
CREATE POLICY "users read own systems" ON public.user_systems
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage user_systems" ON public.user_systems
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 11. Replace permissive specs policies with auth+system-scoped ones
DROP POLICY IF EXISTS "public delete specs" ON public.specs;
DROP POLICY IF EXISTS "public insert specs" ON public.specs;
DROP POLICY IF EXISTS "public read specs" ON public.specs;

REVOKE ALL ON public.specs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.specs TO authenticated;

CREATE POLICY "specs read by access" ON public.specs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR system_id IS NULL
    OR public.user_has_system(auth.uid(), system_id)
  );
CREATE POLICY "specs insert by access" ON public.specs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR system_id IS NULL
    OR public.user_has_system(auth.uid(), system_id)
  );
CREATE POLICY "specs update by access" ON public.specs
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR system_id IS NULL
    OR public.user_has_system(auth.uid(), system_id)
  );
CREATE POLICY "specs delete by access" ON public.specs
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR system_id IS NULL
    OR public.user_has_system(auth.uid(), system_id)
  );

-- 12. Replace permissive scenarios policies (scoped via parent spec)
DROP POLICY IF EXISTS "public delete scenarios" ON public.scenarios;
DROP POLICY IF EXISTS "public insert scenarios" ON public.scenarios;
DROP POLICY IF EXISTS "public read scenarios" ON public.scenarios;
DROP POLICY IF EXISTS "public update scenarios" ON public.scenarios;

REVOKE ALL ON public.scenarios FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenarios TO authenticated;

CREATE POLICY "scenarios read by spec access" ON public.scenarios
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR spec_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.specs s
      WHERE s.id = scenarios.spec_id
        AND (s.system_id IS NULL OR public.user_has_system(auth.uid(), s.system_id))
    )
  );
CREATE POLICY "scenarios write by spec access" ON public.scenarios
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR spec_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.specs s
      WHERE s.id = scenarios.spec_id
        AND (s.system_id IS NULL OR public.user_has_system(auth.uid(), s.system_id))
    )
  );
CREATE POLICY "scenarios update by spec access" ON public.scenarios
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR spec_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.specs s
      WHERE s.id = scenarios.spec_id
        AND (s.system_id IS NULL OR public.user_has_system(auth.uid(), s.system_id))
    )
  );
CREATE POLICY "scenarios delete by spec access" ON public.scenarios
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR spec_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.specs s
      WHERE s.id = scenarios.spec_id
        AND (s.system_id IS NULL OR public.user_has_system(auth.uid(), s.system_id))
    )
  );

-- 13. updated_at triggers
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER systems_touch BEFORE UPDATE ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 14. handle_new_user trigger: create profile + auto-admin for gad.arviv@moh.go.il
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  )
  ON CONFLICT (id) DO NOTHING;

  IF LOWER(NEW.email) = 'gad.arviv@moh.go.il' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 15. Backfill profiles/roles for any existing auth users (and gad as admin if exists)
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, CASE WHEN LOWER(email) = 'gad.arviv@moh.go.il' THEN 'admin'::public.app_role ELSE 'user'::public.app_role END
FROM auth.users
ON CONFLICT DO NOTHING;
