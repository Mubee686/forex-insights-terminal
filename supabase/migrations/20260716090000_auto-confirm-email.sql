-- Disable email-confirmation requirement by:
-- 1. Auto-confirming every new user at the DB level (trigger), and
-- 2. Bulk-confirming all existing unconfirmed accounts.
--
-- This means signInWithPassword succeeds immediately after signUp,
-- with no "email_not_confirmed" error and no email-link click required.

-- ── Bulk-fix all existing unconfirmed accounts ────────────────────────────────
UPDATE auth.users
SET email_confirmed_at = now()
WHERE email_confirmed_at IS NULL;

-- ── Rewrite the new-user trigger to also confirm on INSERT ────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Auto-confirm the email immediately so the user can log in right away
  -- without clicking an email verification link.
  UPDATE auth.users
  SET email_confirmed_at = now()
  WHERE id = NEW.id
    AND email_confirmed_at IS NULL;

  -- Create the user's profile row with a unique membership code.
  INSERT INTO public.profiles (id, full_name, email, member_code)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    public.generate_member_code()
  );

  -- Assign role: admin for the owner email, 'user' for everyone else.
  IF lower(NEW.email) = 'm62804994@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
