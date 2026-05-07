-- V3.0 anon sign-in fix
-- Trigger handle_new_user() inserted NEW.email into profiles for every auth.users insert.
-- Anonymous users have NULL email, which violated profiles.email NOT NULL.
-- This migration: (1) makes profiles.email nullable, (2) replaces trigger with null-safe version.

ALTER TABLE public.profiles ALTER COLUMN email DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      case when new.email is not null then split_part(new.email,'@',1) else 'Guest' end
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;