from tests.conftest import PASSWORD, create_user, login, new_email, register, sql


async def _fail(client, n, email="a@example.com"):
    codes = []
    for _ in range(n):
        codes.append((await login(client, email, "wrong-password-1")).status_code)
    return codes


async def test_lockout_on_fifth_failure_refuses_correct_password(client):
    await create_user("a@example.com")
    assert await _fail(client, 5) == [401] * 5
    r = await login(client, "a@example.com", PASSWORD)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "too_many_attempts"
    retry = int(r.headers["retry-after"])
    assert 890 <= retry <= 900
    # the password is not even verified while locked: failure counter stays untouched
    assert (await sql("SELECT fail_count, lock_level FROM auth_throttle WHERE key LIKE 'acct:%'"))[0] == (0, 1)


async def test_sixth_wrong_attempt_is_429(client):
    await create_user("a@example.com")
    assert await _fail(client, 6) == [401] * 5 + [429]


async def test_lock_doubles(client):
    await create_user("a@example.com")
    await _fail(client, 5)
    await sql("UPDATE auth_throttle SET locked_until = now() - interval '1 second' WHERE key LIKE 'acct:%'")
    assert await _fail(client, 5) == [401] * 5
    r = await login(client, "a@example.com", PASSWORD)
    assert r.status_code == 429
    assert 1790 <= int(r.headers["retry-after"]) <= 1800
    assert (await sql("SELECT lock_level FROM auth_throttle WHERE key LIKE 'acct:%'"))[0][0] == 2


async def test_lock_capped_at_24h(client, settings):
    await create_user("a@example.com")
    await _fail(client, 5)
    await sql("UPDATE auth_throttle SET locked_until = now() - interval '1 second', lock_level = 20 WHERE key LIKE 'acct:%'")
    await _fail(client, 5)
    r = await login(client, "a@example.com", PASSWORD)
    assert 86390 <= int(r.headers["retry-after"]) <= 86400


async def test_success_resets_failures_and_level(client):
    await create_user("a@example.com")
    await _fail(client, 4)
    assert (await login(client, "a@example.com")).status_code == 200
    assert (await sql("SELECT count(*) FROM auth_throttle WHERE key LIKE 'acct:%'"))[0][0] == 0
    # four more failures do not lock (counter was reset)
    assert await _fail(client, 4) == [401] * 4


async def test_failures_are_per_email_and_ip(make_client):
    await create_user("a@example.com")
    await create_user("b@example.com")
    c = make_client()
    await _fail(c, 5)
    assert (await login(c, "b@example.com")).status_code == 200  # other email unaffected
    other_ip = make_client(peer="192.0.2.9")
    assert (await login(other_ip, "a@example.com")).status_code == 200  # other IP unaffected


async def test_ip_login_limit(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "ip_login_max", 3)
    await create_user("a@example.com")
    assert (await login(client, "a@example.com")).status_code == 200
    assert (await login(client, "a@example.com")).status_code == 200
    assert (await login(client, "a@example.com")).status_code == 200
    r = await login(client, "a@example.com")
    assert r.status_code == 429 and "retry-after" in r.headers


async def test_registration_limit(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "reg_max", 2)
    assert (await register(client, new_email())).status_code == 201
    assert (await register(client, new_email())).status_code == 201
    r = await register(client, new_email())
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_attempts"
    assert int(r.headers["retry-after"]) > 0


async def test_disabled_account_only_after_correct_password(client):
    await create_user("d@example.com", status="disabled")
    assert (await login(client, "d@example.com", "wrong-password-1")).status_code == 401
    r = await login(client, "d@example.com")
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_disabled"


async def test_xff_honoured_only_from_trusted_peer(make_client):
    await create_user("a@example.com")
    # trusted peer (docker network): the XFF first hop is the client
    proxy = make_client(peer="172.18.0.5", headers={"X-Forwarded-For": "203.0.113.7, 172.18.0.5"})
    await _fail(proxy, 5)
    assert (await sql("SELECT count(*) FROM auth_throttle WHERE key = 'acct:a@example.com|203.0.113.7'"))[0][0] == 1
    # untrusted peer: header is ignored, the peer IP is used
    direct = make_client(peer="198.51.100.4", headers={"X-Forwarded-For": "203.0.113.99"})
    await _fail(direct, 1)
    keys = {r[0] for r in await sql("SELECT key FROM auth_throttle")}
    assert "acct:a@example.com|198.51.100.4" in keys
    assert not any("203.0.113.99" in k for k in keys)
    # garbage XFF from a trusted peer falls back to the peer IP
    junk = make_client(peer="10.1.2.3", headers={"X-Forwarded-For": "not-an-ip"})
    await _fail(junk, 1)
    assert "acct:a@example.com|10.1.2.3" in {r[0] for r in await sql("SELECT key FROM auth_throttle")}
