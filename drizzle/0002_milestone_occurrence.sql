-- Next calendar occurrence of a recurring milestone.
--
-- Written as a database function rather than application code so the upcoming
-- lists, the dashboard counts and any future reminder job all agree on what
-- "next" means, and so the work stays inside one indexed query.
--
-- Leap-day handling: a 29 February anniversary clamps to 28 February in a
-- common year rather than erroring or disappearing from the list.

CREATE OR REPLACE FUNCTION "vara5_next_occurrence"(
  p_month int,
  p_day int,
  p_from date
)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT min(candidate)
  FROM (
    SELECT least(
             make_date(y, p_month, 1) + (p_day - 1),
             (make_date(y, p_month, 1) + interval '1 month - 1 day')::date
           ) AS candidate
    FROM (
      SELECT extract(year FROM p_from)::int + offset_years AS y
      FROM generate_series(0, 1) AS offset_years
    ) AS years
  ) AS candidates
  WHERE candidate >= p_from;
$$;

--> statement-breakpoint

-- Days remaining until a milestone's next occurrence. Null for a one-off date
-- that has already passed.
CREATE OR REPLACE FUNCTION "vara5_days_until"(
  p_month int,
  p_day int,
  p_from date
)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ("vara5_next_occurrence"(p_month, p_day, p_from) - p_from)::int;
$$;
