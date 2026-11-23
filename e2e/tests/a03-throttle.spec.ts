import { expect, newApi, registerViaApi, test } from './helpers'

test('A3: 5 wrong logins -> 401 (identical), 6th -> 429 + Retry-After, correct password also 429', async () => {
  const user = await registerViaApi()
  await user.api.dispose()
  const api = await newApi() // anonymous: no session cookie
  try {
    const login = (password: string) => api.post('/api/auth/login', { data: { email: user.email, password } })

    const bodies: unknown[] = []
    for (let i = 1; i <= 5; i++) {
      const res = await login(`Wrong-Password-${i}!`)
      expect(res.status(), `wrong attempt #${i}`).toBe(401)
      const body = await res.json()
      expect(body.error.code).toBe('invalid_credentials')
      bodies.push(body)
    }
    for (const b of bodies) expect(b).toEqual(bodies[0]) // generic message, nothing that varies per attempt

    const locked = await login('Wrong-Password-6!')
    expect(locked.status(), 'attempt #6').toBe(429)
    const retryAfter = locked.headers()['retry-after']
    expect(retryAfter, 'Retry-After header').toMatch(/^\d+$/)
    expect(Number(retryAfter)).toBeGreaterThan(0)
    expect((await locked.json()).error.code).toBe('too_many_attempts')

    const correct = await login(user.password)
    expect(correct.status(), 'correct password while locked').toBe(429)
  } finally {
    await api.dispose()
  }
})
