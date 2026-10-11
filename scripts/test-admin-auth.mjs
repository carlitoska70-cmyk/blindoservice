import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { COOKIE, SESSION_SECONDS, digest, randomKey, config, readSession, login, logout } from '../lib/admin-auth.ts';

const schema = readFileSync(new URL('./admin-login-schema.sql', import.meta.url), 'utf8');
const password = randomKey();
const raw = JSON.stringify({ email: 'owner@example.com', keyHash: await digest(password) });
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  sqlite.exec(schema);
  for (const name of ['profiles','records','files','portals','visits','portal_events']) sqlite.exec(`CREATE TABLE ${name}(owner TEXT NOT NULL)`);
  return { sqlite, prepare(sql) {
    const stmt = sqlite.prepare(sql);
    let values = [];
    return { bind(...v) { values = v; return this; }, async first() { return stmt.get(...values) ?? null; }, async all() { return { results: stmt.all(...values) }; }, async run() { return stmt.run(...values); } };
  } };
}
function request(overrides = {}) {
  const { headers = {}, body, ...options } = overrides;
  return new Request('https://example.com/api/auth/login', {
    method: 'POST', body: body ?? new URLSearchParams({email:'owner@example.com', password}),
    ...options, headers: { origin: 'https://example.com', 'content-type':'application/x-www-form-urlencoded', 'cf-connecting-ip':'192.0.2.1', ...headers },
  });
}
function token(response) { return response.headers.get('set-cookie')?.split(';')[0].slice(COOKIE.length + 1); }
test('valid login creates a hashed, eight-hour session with hardened cookie', async () => {
  const db = database(), response = await login(request(), db, raw), key = token(response);
  assert.equal(response.status,303); assert.equal(response.headers.get('location'),'/');
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax; Max-Age=28800/);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await readSession(db,raw,key)).email,'owner@example.com');
  const stored = db.sqlite.prepare('SELECT * FROM admin_sessions').get();
  assert.notEqual(stored.token_hash,key); assert.equal(stored.token_hash, await digest(key));
  assert.ok(Math.abs(stored.expires - Math.floor(Date.now()/1000) - SESSION_SECONDS) < 3);
});
test('wrong email, wrong password and duplicate fields never create sessions', async () => {
  const db=database();
  for(const body of [new URLSearchParams({email:'other@example.com',password}), new URLSearchParams({email:'owner@example.com',password:randomKey()}), new URLSearchParams([['email','owner@example.com'],['password',password],['password',password]])]) {
    const r=await login(request({body}),db,raw);
    assert.equal(r.headers.get('location'),'/login?error=credentials'); assert.equal(r.headers.get('set-cookie'),null);
  }
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM admin_sessions').get().n,0);
});
test('missing, malformed and changed configuration fails closed', async () => {
  assert.throws(()=>config('{}')); assert.throws(()=>config(null)); assert.throws(()=>config('null'));
  const db=database();
  assert.equal((await login(request(),db,undefined)).headers.get('location'),'/login?error=configuration');
  const key=token(await login(request(),db,raw));
  assert.equal(await readSession(db,JSON.stringify({email:'owner@example.com',keyHash:await digest(randomKey())}),key),null);
});
test('existing owner ID is preserved, new identity stays stable', async () => {
  const db=database(); db.sqlite.prepare('INSERT INTO records(owner) VALUES(?)').run('original-chatgpt-owner');
  for(let i=0;i<2;i++) assert.equal((await readSession(db,raw,token(await login(request(),db,raw)))).userId,'original-chatgpt-owner');
  const fresh=database();
  const a=await readSession(fresh,raw,token(await login(request(),fresh,raw)));
  const b=await readSession(fresh,raw,token(await login(request(),fresh,raw)));
  assert.equal(a.userId,b.userId);
});
test('multiple existing owners are not merged or guessed', async () => {
  const db=database(); db.sqlite.exec("INSERT INTO profiles VALUES('one'); INSERT INTO files VALUES('two');");
  const r=await login(request(),db,raw); assert.equal(r.headers.get('location'),'/login?error=configuration');
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM admin_sessions').get().n,0);
});
test('cross-origin, missing-origin, cross-site and insecure requests rejected', async () => {
  const db=database();
  for(const headers of [{origin:'https://evil.example'}, {origin:''}, {'sec-fetch-site':'cross-site'}]) {
    assert.equal((await login(request({headers}),db,raw)).status,403);
    assert.equal((await logout(request({headers}),db)).status,403);
  }
  assert.equal((await login(new Request('http://example.com/api/auth/login',{method:'POST',headers:{origin:'http://example.com'}}),db,raw)).status,403);
});
test('oversized bodies rejected even without content-length', async () => {
  const db=database();
  assert.equal((await login(request({body:'x'.repeat(5000)}),db,raw)).status,413);
  assert.equal((await login(request({headers:{'content-length':'9000'}}),db,raw)).status,413);
  assert.equal((await login(request({headers:{'content-type':'application/json'}}),db,raw)).status,415);
});
test('rate limiting applies after ten attempts for an IP', async () => {
  const db=database();
  for(let i=0;i<10;i++) assert.equal((await login(request({body:'email=x&password=x'}),db,raw)).status,303);
  const r=await login(request(),db,raw); assert.equal(r.status,429); assert.equal(r.headers.get('retry-after'),'900');
});
test('global limiter caps distributed attempts', async () => {
  const db=database();
  for(let i=0;i<60;i++) await login(request({body:'email=x&password=x',headers:{'cf-connecting-ip':`192.0.2.${i}`}}),db,raw);
  assert.equal((await login(request({headers:{'cf-connecting-ip':'192.0.2.254'}}),db,raw)).status,429);
});
test('logout revokes server-side session and clears the cookie', async () => {
  const db=database(), key=token(await login(request(),db,raw));
  const r=await logout(request({headers:{cookie:`${COOKIE}=${key}`}}),db);
  assert.equal(r.status,303); assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal(await readSession(db,raw,key),null);
});
test('session rotation, expiration and forgery', async () => {
  const db=database(), key=token(await login(request(),db,raw));
  const second=token(await login(request({headers:{cookie:`${COOKIE}=${key}`}}),db,raw));
  assert.notEqual(second,key); assert.equal(await readSession(db,raw,key),null);
  assert.equal(await readSession(db,raw,randomKey()),null);
  assert.equal(await readSession(db,raw,'malformed'),null);
  db.sqlite.exec('UPDATE admin_sessions SET expires=0');
  assert.equal(await readSession(db,raw,second),null);
});
test('forged ChatGPT identity headers cannot log in', async () => {
  const db=database();
  const r=await login(request({body:'email=x&password=x',headers:{'oai-authenticated-user-id':'admin','oai-authenticated-user-email':'owner@example.com'}}),db,raw);
  assert.equal(r.headers.get('location'),'/login?error=credentials');
  const operator=readFileSync(new URL('../lib/operator.ts',import.meta.url),'utf8');
  assert.ok(!operator.includes('chatgpt-auth')); assert.ok(operator.includes('readSession'));
});
test('storage failure never produces an authenticated response', async () => {
  const broken={prepare(){throw new Error('offline');}};
  assert.equal((await login(request(),broken,raw)).headers.get('location'),'/login?error=configuration');
  assert.equal((await logout(request({headers:{cookie:`${COOKIE}=${randomKey()}`}}),broken)).status,503);
});
