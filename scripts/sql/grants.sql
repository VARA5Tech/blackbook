-- Why a query on an existing table fails.
--
--   pnpm db:grants:prod
--
-- Three things can make `select count(*) from preference_option` fail on a
-- database where the table demonstrably exists, and they look identical from
-- the application:
--
--   1. The connecting role has no GRANT on the table. Common on a self-hosted
--      Supabase, where Studio runs statements as supabase_admin, so a schema
--      pasted into the SQL editor is owned by supabase_admin and not by the
--      postgres role the application connects as.
--   2. Row-level security applies to the connecting role. Every table here has
--      RLS on with no policies, to shut PostgREST out. The owner bypasses it;
--      a non-owner without BYPASSRLS sees nothing.
--   3. The table is in a schema that is not on the role's search_path.
--
-- This reports all three at once, for the role actually connecting. One
-- statement, because the query runner sends one.
select
  c.relname                                          as table_name,
  pg_get_userbyid(c.relowner)                        as owner,
  current_user                                       as me,
  (select rolbypassrls from pg_roles where rolname = current_user) as i_bypass_rls,
  c.relrowsecurity                                   as rls_on,
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as policies,
  has_table_privilege(current_user, c.oid, 'SELECT') as can_select,
  has_table_privilege(current_user, c.oid, 'INSERT') as can_insert,
  current_setting('search_path')                     as search_path
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;
