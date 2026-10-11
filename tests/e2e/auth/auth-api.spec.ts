import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * 登录体系 API 级 e2e（AUTH_MODE=user 独立 server，见 playwright.auth.config.ts）。
 * 命中真实 dev DB，用户名随机后缀避免冲突。
 */

const INVITE_CODE = process.env.ACCESS_CODE;
if (!INVITE_CODE) {
  throw new Error('ACCESS_CODE missing: e2e auth tests require it as the invite code');
}

const VALID_PASSWORD = 'abc12345';

function uniqueName(prefix: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}${suffix}`.slice(0, 20);
}

async function registerUser(request: APIRequestContext, username: string) {
  const res = await request.post('/api/auth/register', {
    data: { username, password: VALID_PASSWORD, inviteCode: INVITE_CODE },
  });
  return res;
}

test.describe('registration', () => {
  test('rejects an invalid invite code', async ({ request }) => {
    const res = await request.post('/api/auth/register', {
      data: { username: uniqueName('inv'), password: VALID_PASSWORD, inviteCode: 'wrong-code' },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('INVITE_INVALID');
  });

  test('rejects duplicate usernames', async ({ request }) => {
    const username = uniqueName('dup');
    expect((await registerUser(request, username)).status()).toBe(200);
    const dup = await registerUser(request, username);
    expect(dup.status()).toBe(409);
  });
});

test.describe('login lifecycle', () => {
  test('register → session → protected API → logout → 401', async ({ request }) => {
    const username = uniqueName('life');
    expect((await registerUser(request, username)).status()).toBe(200);

    const session = await request.get('/api/auth/session');
    const sessionBody = await session.json();
    expect(sessionBody.authenticated).toBe(true);
    expect(sessionBody.user.username).toBe(username);

    // session 注入身份后可访问受保护接口
    const wardrobe = await request.get('/api/wardrobe');
    expect(wardrobe.status()).toBe(200);

    await request.post('/api/auth/logout');
    expect((await (await request.get('/api/auth/session')).json()).authenticated).toBe(false);

    const blocked = await request.get('/api/wardrobe');
    expect(blocked.status()).toBe(401);
    expect((await blocked.json()).code).toBe('UNAUTHENTICATED');
  });

  test('locks after 5 consecutive failures', async ({ request }) => {
    const username = uniqueName('lock');
    expect((await registerUser(request, username)).status()).toBe(200);
    await request.post('/api/auth/logout');

    let lastStatus = 0;
    for (let i = 0; i < 5; i += 1) {
      const res = await request.post('/api/auth/login', {
        data: { username, password: 'wrongpass1' },
      });
      lastStatus = res.status();
    }
    expect(lastStatus).toBe(423);

    const lockedAgain = await request.post('/api/auth/login', {
      data: { username, password: VALID_PASSWORD },
    });
    expect(lockedAgain.status()).toBe(423);
    expect((await lockedAgain.json()).code).toBe('ACCOUNT_LOCKED');
  });
});

test.describe('data isolation', () => {
  test('user B cannot read or delete user A conversation', async ({ request }) => {
    // A 注册并建会话（同一 request context 内 cookie 独立传递，改用两个 context）
    const usernameA = uniqueName('ua');
    expect((await registerUser(request, usernameA)).status()).toBe(200);
    const created = await request.post('/api/conversations', {
      data: { title: 'A 的私密会话' },
    });
    expect(created.status()).toBe(201);
    const conversation = await created.json();
    const listA = await (await request.get('/api/conversations')).json();
    expect(listA.map((c: { id: string }) => c.id)).toContain(conversation.id);

    // 登出 A，注册 B
    await request.post('/api/auth/logout');
    const usernameB = uniqueName('ub');
    expect((await registerUser(request, usernameB)).status()).toBe(200);

    // B 读 A 的消息：按归属过滤，拿不到内容
    const messages = await request.get(`/api/conversations/${conversation.id}/messages`);
    expect(messages.status()).toBe(200);
    expect(await messages.json()).toEqual([]);

    // B 删 A 的会话：404（不暴露存在性）
    const del = await request.delete(`/api/conversations/${conversation.id}`);
    expect(del.status()).toBe(404);

    // B 的会话列表为空
    const list = await request.get('/api/conversations');
    expect((await list.json()).length).toBe(0);
  });
});

test.describe('password reset', () => {
  test('security questions reset revokes old sessions', async ({ request }) => {
    const username = uniqueName('reset');
    expect((await registerUser(request, username)).status()).toBe(200);

    const setQ = await request.post('/api/auth/security-questions', {
      data: {
        questions: [
          { question: '我的小学名字是什么', answer: '阳光小学' },
          { question: '我出生的城市是哪里', answer: '成都' },
        ],
      },
    });
    expect(setQ.status()).toBe(200);

    // 登出后走找回流程
    await request.post('/api/auth/logout');

    const questions = await request.get(`/api/auth/security-questions?username=${username}`);
    expect((await questions.json()).questions.length).toBe(2);

    // 答案归一化：大小写/全半角不敏感
    const reset = await request.post('/api/auth/reset-password', {
      data: {
        username,
        method: 'questions',
        answers: [' 阳光小学 ', '成都'],
        newPassword: 'newpass123',
      },
    });
    expect(reset.status()).toBe(200);

    // 重置后自动登录
    expect((await (await request.get('/api/auth/session')).json()).authenticated).toBe(true);
    await request.post('/api/auth/logout');

    // 旧密码失效，新密码可登录
    const oldLogin = await request.post('/api/auth/login', {
      data: { username, password: VALID_PASSWORD },
    });
    expect(oldLogin.status()).toBe(401);
    const newLogin = await request.post('/api/auth/login', {
      data: { username, password: 'newpass123' },
    });
    expect(newLogin.status()).toBe(200);
  });

  test('recovery code resets password and is single-use', async ({ request }) => {
    const username = uniqueName('rec');
    expect((await registerUser(request, username)).status()).toBe(200);

    const codesRes = await request.post('/api/auth/recovery-codes');
    expect(codesRes.status()).toBe(200);
    const { codes } = await codesRes.json();
    expect(codes.length).toBe(8);

    await request.post('/api/auth/logout');

    const reset = await request.post('/api/auth/reset-password', {
      data: {
        username,
        method: 'recovery',
        recoveryCode: codes[0].toLowerCase(), // 归一化：大小写不敏感
        newPassword: 'newpass123',
      },
    });
    expect(reset.status()).toBe(200);

    await request.post('/api/auth/logout');

    // 同一恢复码不可复用
    const reuse = await request.post('/api/auth/reset-password', {
      data: {
        username,
        method: 'recovery',
        recoveryCode: codes[0],
        newPassword: 'anotherpass1',
      },
    });
    expect(reuse.status()).toBe(403);
    expect((await reuse.json()).code).toBe('RECOVERY_INVALID');
  });
});
