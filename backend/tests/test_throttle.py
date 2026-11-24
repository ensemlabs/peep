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
    # successful logins never consume the per-IP budget
    for _ in range(6):
        assert (await login(client, "a@example.com")).status_code == 200
    assert await _fail(client, 3, email="nobody@example.com") == [401] * 3
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


async def test_xff_walked_right_to_left(make_client, settings, monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxies", "172.16.0.0/12,10.0.0.0/8")
    await create_user("a@example.com")
    # the client prepends "spoofed"; the trusted proxy appended the address it really saw
    spoof = make_client(peer="172.18.0.5", headers={"X-Forwarded-For": "1.2.3.4, 203.0.113.7"})
    await _fail(spoof, 1)
    # two trusted proxies in a chain: peer -> 10.0.0.9 (trusted) -> 203.0.113.8 (client)
    chain = make_client(peer="172.18.0.5", headers={"X-Forwarded-For": "6.6.6.6, 203.0.113.8, 10.0.0.9"})
    await _fail(chain, 1)
    # every hop trusted: the left-most valid one
    inner = make_client(peer="172.18.0.5", headers={"X-Forwarded-For": "10.1.1.1, 10.0.0.9"})
    await _fail(inner, 1)
    # garbage XFF from a trusted peer falls back to the peer IP
    junk = make_client(peer="10.1.2.3", headers={"X-Forwarded-For": "not-an-ip"})
    await _fail(junk, 1)
    keys = {r[0] for r in await sql("SELECT key FROM auth_throttle")}
    assert {"acct:a@example.com|203.0.113.7", "acct:a@example.com|203.0.113.8", "acct:a@example.com|10.1.1.1",
            "acct:a@example.com|10.1.2.3"} <= keys
    assert not any("1.2.3.4" in k or "6.6.6.6" in k for k in keys)


async def test_xff_untrusted_peer_ignored(make_client, settings, monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxies", "172.16.0.0/12,10.0.0.0/8")
    await create_user("a@example.com")
    direct = make_client(peer="198.51.100.4", headers={"X-Forwarded-For": "203.0.113.99"})
    await _fail(direct, 1)
    keys = {r[0] for r in await sql("SELECT key FROM auth_throttle")}
    assert "acct:a@example.com|198.51.100.4" in keys
    assert not any("203.0.113.99" in k for k in keys)


async def test_xff_ignored_when_no_proxy_is_trusted(make_client, settings, monkeypatch):
    # The default: nobody is trusted, so a spoofed header can never pick the throttle key.
    monkeypatch.setattr(settings, "trusted_proxies", "")
    await create_user("a@example.com")
    for peer in ("172.18.0.1", "10.1.2.3", "198.51.100.4"):
        c = make_client(peer=peer, headers={"X-Forwarded-For": "203.0.113.7"})
        await _fail(c, 1)
    keys = {r[0] for r in await sql("SELECT key FROM auth_throttle")}
    assert "acct:a@example.com|172.18.0.1" in keys and "acct:a@example.com|198.51.100.4" in keys
    assert not any("203.0.113.7" in k for k in keys)


async def test_xff_first_hop_used_from_configured_proxy(make_client, settings, monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxies", "192.0.2.10")
    await create_user("a@example.com")
    proxy = make_client(peer="192.0.2.10", headers={"X-Forwarded-For": "203.0.113.7, 192.0.2.10"})
    await _fail(proxy, 1)
    other = make_client(peer="192.0.2.11", headers={"X-Forwarded-For": "203.0.113.8"})
    await _fail(other, 1)
    keys = {r[0] for r in await sql("SELECT key FROM auth_throttle")}
    assert "acct:a@example.com|203.0.113.7" in keys
    assert "acct:a@example.com|192.0.2.11" in keys
