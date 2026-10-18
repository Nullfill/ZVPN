export async function recordDailyActivity(client, userId, date) {
  await client.query(`INSERT INTO user_activity_daily(activity_date,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [date,userId]);
}

export async function dailyActivitySummary(client, timezone) {
  const {rows:[row]} = await client.query(`
    WITH day AS (SELECT (now() AT TIME ZONE $1)::date AS date), seen AS (
      SELECT user_id FROM user_activity_daily,day WHERE activity_date=day.date
      UNION
      SELECT id FROM vpn_users,day WHERE (last_seen_at AT TIME ZONE $1)::date=day.date
    ) SELECT to_char(day.date,'YYYY-MM-DD') AS date,(SELECT count(*)::int FROM seen) AS users FROM day`, [timezone]);
  return {date:row.date, uniqueUsers:row.users, timezone};
}
