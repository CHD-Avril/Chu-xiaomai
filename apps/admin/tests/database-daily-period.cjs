const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    const root = path.resolve(__dirname, '../../..');
    const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace('create extension if not exists pgcrypto;', '');
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email',true),'') $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',auth.email()) $$;
      grant usage on schema auth to anon,authenticated;`);
    for (const file of ['supabase-schema.sql', 'supabase-admin-workflow.sql', 'supabase-database-integrity.sql', 'supabase-test-mode.sql', 'supabase-daily-period.sql', 'supabase-daily-period.sql']) await db.exec(read(file));
    const admin = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    await db.query("insert into auth.users values($1,'admin@example.invalid'),($2,'other@example.invalid')", [admin, other]);
    await db.query("insert into admin_users(email,user_id) values('admin@example.invalid',$1)", [admin]);
    const role = async (name, id = '') => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)", [id, id === admin ? 'admin@example.invalid' : 'other@example.invalid']);
      await db.exec('set role ' + name);
    };
    const tomorrow = "((clock_timestamp() at time zone 'Asia/Shanghai')::date + 1)";
    const call = (id = null, updatedAt = null, endTime = '18:00') => one(`select admin_prepare_daily_period(${tomorrow},'每日征集','00:00',$1,$2,$3) result`, [endTime, id, updatedAt]);
    await role('anon'); await assert.rejects(call(), /permission denied/);
    await role('authenticated', other); await assert.rejects(call(), /Admin permission required/);
    await role('authenticated', admin);
    // Session timezone must not affect the Beijing schedule.
    await db.exec("set timezone='America/Los_Angeles'");
    const first = (await call()).result; assert.equal(first.created, true);
    assert.equal((await call()).result.id, first.id); assert.equal((await call()).result.created, false);
    assert.equal((await one('select count(*)::int n from playlist_periods')).n, 1);
    const times = await one("select to_char(starts_at at time zone 'Asia/Shanghai','HH24:MI') start_time,to_char(ends_at at time zone 'Asia/Shanghai','HH24:MI') end_time from playlist_periods where id=$1", [first.id]);
    assert.deepEqual(times, { start_time: '00:00', end_time: '18:00' });
    assert.equal((await one("select count(*)::int n from admin_action_log where action='create_period'")).n, 1);
    for (const end of ['00:00', '24:00']) await assert.rejects(call(null, null, end), /有效/);
    await assert.rejects(one(`select admin_prepare_daily_period(${tomorrow} + 1,'bad','00:00','18:00',null,null)`), /日期已变化/);
    await assert.rejects(one(`select admin_prepare_daily_period(${tomorrow},'','00:00','18:00',null,null)`), /有效/);
    await assert.rejects(one("select admin_prepare_daily_period((clock_timestamp() at time zone 'Asia/Shanghai')::date,'expired','00:00','00:00:00.000001',null,null)"), /已经过去/);
    console.log('PASS permissions, repeat migration, Beijing timezone, duplicate save and invalid windows');

    // Existing songs survive duplicate setup.
    await db.exec('reset role');
    await db.query("insert into songs(title,artist,title_lower,artist_lower,playlist_date,created_by) values('已有歌曲','歌手','已有歌曲','歌手',$1,'visitor')", [first.id]);
    await role('authenticated', admin); await call();
    assert.equal((await one('select count(*)::int n from songs')).n, 1);
    await db.exec('reset role');
    await db.query('update playlist_periods set is_test=true where id=$1', [first.id]);
    await role('authenticated', admin); await assert.rejects(call(), /测试期/);
    await db.exec('reset role');
    await db.query("update playlist_periods set is_test=false,starts_at=starts_at+interval '2 days',ends_at=ends_at+interval '2 days' where id=$1", [first.id]);
    await role('authenticated', admin); await assert.rejects(call(), /更晚日期/);
    // A title saying 'tomorrow' is never used to guess the actual window.
    await db.exec('reset role');
    await db.query("update playlist_periods set title='明日征集',starts_at=now()-interval '2 days',ends_at=now()-interval '1 day',updated_at=clock_timestamp() where id=$1", [first.id]);
    await role('authenticated', admin);
    await assert.rejects(call(), /其他管理员/);
    const previous = await one('select id,updated_at::text from playlist_periods where id=$1', [first.id]);
    await assert.rejects(call(first.id, '2000-01-01T00:00:00Z'), /其他管理员/);
    // A failed insert must also roll back archiving the old period.
    await db.exec('reset role');
    await db.exec("create function reject_daily_insert() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end $$; create trigger reject_daily_insert before insert on playlist_periods for each row execute function reject_daily_insert();");
    await role('authenticated', admin); await assert.rejects(call(first.id, previous.updated_at), /simulated failure/);
    assert.equal((await one('select status from playlist_periods where id=$1', [first.id])).status, 'active');
    await db.exec('reset role; drop trigger reject_daily_insert on playlist_periods');
    await role('authenticated', admin);
    const next = (await call(first.id, previous.updated_at)).result;
    assert.equal(next.created, true); assert.notEqual(next.id, first.id);
    assert.equal((await one('select status from playlist_periods where id=$1', [first.id])).status, 'archived');
    assert.equal((await call(first.id, previous.updated_at)).result.id, next.id);
    assert.equal((await one("select count(*)::int n from playlist_periods where status='active'")).n, 1);
    assert.equal((await one('select count(*)::int n from songs')).n, 1);
    console.log('PASS existing songs retained, test/future protection, stale snapshot rejection and atomic rollback');
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
