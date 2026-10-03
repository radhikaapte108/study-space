const assert = require('node:assert/strict');
const test = require('node:test');
const session = require('express-session');
const { createApp } = require('../server');

function createFakeModels() {
  const users = new Map();
  const assignments = new Map();
  let nextUserId = 1;
  let nextAssignmentId = 1;

  const userModel = {
    async create(values) {
      if ([...users.values()].some((user) => user.email === values.email)) {
        const error = new Error('Duplicate email.');
        error.code = 11000;
        throw error;
      }
      const user = { ...values, _id: `user-${nextUserId++}` };
      user.id = user._id;
      users.set(user.id, user);
      return user;
    },
    findById(id) {
      return { select: async () => users.get(String(id)) || null };
    },
    findOne(query) {
      return {
        select: async () => [...users.values()].find((user) => user.email === query.email) || null
      };
    }
  };

  function matches(assignment, filter) {
    return assignment._id === String(filter._id || assignment._id) &&
      (!filter.owner || assignment.owner === String(filter.owner)) &&
      (!filter.status || assignment.status === filter.status);
  }

  const assignmentModel = {
    async create(values) {
      const assignment = {
        ...values,
        _id: `assignment-${nextAssignmentId++}`,
        owner: String(values.owner),
        description: values.description || '',
        createdAt: new Date().toISOString()
      };
      assignments.set(assignment._id, assignment);
      return { ...assignment };
    },
    find(filter) {
      return {
        sort: async () => [...assignments.values()].filter((item) => matches(item, filter)).map((item) => ({ ...item }))
      };
    },
    async findOne(filter) {
      const assignment = assignments.get(String(filter._id));
      return assignment && matches(assignment, filter) ? { ...assignment } : null;
    },
    async findOneAndUpdate(filter, changes) {
      const assignment = assignments.get(String(filter._id));
      if (!assignment || !matches(assignment, filter)) return null;
      Object.assign(assignment, changes);
      return { ...assignment };
    },
    async findOneAndDelete(filter) {
      const assignment = assignments.get(String(filter._id));
      if (!assignment || !matches(assignment, filter)) return null;
      assignments.delete(assignment._id);
      return { ...assignment };
    }
  };

  return { userModel, assignmentModel };
}

function createClient() {
  return { cookie: '', csrfToken: '' };
}

async function send(client, path, { method = 'GET', body, csrfToken = client.csrfToken } = {}) {
  const headers = {};
  if (client.cookie) headers.Cookie = client.cookie;
  if (body) headers['Content-Type'] = 'application/json';
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    client.cookie = /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(setCookie) ? '' : setCookie.split(';')[0];
  }
  const data = await response.json();
  return { response, data };
}

let server;
let baseUrl;
let alice;
let bob;
let assignmentId;

test.before(async () => {
  const models = createFakeModels();
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    ...models
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  alice = createClient();
  bob = createClient();

  for (const [client, name, email] of [
    [alice, 'Alice Student', 'alice@example.com'],
    [bob, 'Bob Student', 'bob@example.com']
  ]) {
    const initialSession = await send(client, '/api/auth/session');
    client.csrfToken = initialSession.data.csrfToken;
    const registration = await send(client, '/api/auth/register', {
      method: 'POST',
      body: { name, email, password: 'a-secure-test-password' }
    });
    assert.equal(registration.response.status, 201);
    client.csrfToken = registration.data.csrfToken;
  }

  const created = await send(alice, '/api/assignments', {
    method: 'POST',
    body: {
      subject: 'Biology',
      title: 'Cell structure',
      deadline: '2027-02-01',
      priority: 'High',
      status: 'Pending',
      owner: 'user-2'
    }
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.owner, 'user-1');
  assignmentId = created.data._id;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('assignment API rejects unauthenticated requests and missing CSRF tokens', async () => {
  const anonymous = await fetch(`${baseUrl}/api/assignments`);
  assert.equal(anonymous.status, 401);

  const forbidden = await send(alice, '/api/assignments', {
    method: 'POST',
    csrfToken: '',
    body: { subject: 'Math' }
  });
  assert.equal(forbidden.response.status, 403);
});

test('users only list and read their own assignments', async () => {
  const aliceList = await send(alice, '/api/assignments');
  const bobList = await send(bob, '/api/assignments');
  assert.equal(aliceList.data.length, 1);
  assert.equal(bobList.data.length, 0);

  const bobRead = await send(bob, `/api/assignments/${assignmentId}`);
  assert.equal(bobRead.response.status, 404);
});

test('users cannot update, change status, or delete another user assignment', async () => {
  const update = await send(bob, `/api/assignments/${assignmentId}`, {
    method: 'PUT',
    body: {
      subject: 'Stolen',
      title: 'Attempted edit',
      deadline: '2027-02-02',
      priority: 'Low',
      status: 'Completed',
      owner: 'user-2'
    }
  });
  const status = await send(bob, `/api/assignments/${assignmentId}/status`, {
    method: 'PATCH',
    body: { status: 'Completed' }
  });
  const deletion = await send(bob, `/api/assignments/${assignmentId}`, { method: 'DELETE' });
  assert.equal(update.response.status, 404);
  assert.equal(status.response.status, 404);
  assert.equal(deletion.response.status, 404);

  const aliceRead = await send(alice, `/api/assignments/${assignmentId}`);
  assert.equal(aliceRead.response.status, 200);
  assert.equal(aliceRead.data.title, 'Cell structure');
  assert.equal(aliceRead.data.owner, 'user-1');
});

test('an owner can edit, change status, and delete their assignment', async () => {
  const update = await send(alice, `/api/assignments/${assignmentId}`, {
    method: 'PUT',
    body: {
      subject: 'Biology',
      title: 'Cell structure revision',
      deadline: '2027-02-02',
      priority: 'Medium',
      status: 'Pending',
      owner: 'user-2'
    }
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.data.title, 'Cell structure revision');
  assert.equal(update.data.owner, 'user-1');

  const status = await send(alice, `/api/assignments/${assignmentId}/status`, {
    method: 'PATCH',
    body: { status: 'Completed' }
  });
  assert.equal(status.response.status, 200);
  assert.equal(status.data.status, 'Completed');

  const deletion = await send(alice, `/api/assignments/${assignmentId}`, { method: 'DELETE' });
  assert.equal(deletion.response.status, 200);
});

test('users can sign out and sign in again', async () => {
  const logout = await send(alice, '/api/auth/logout', { method: 'POST' });
  assert.equal(logout.response.status, 200);

  const signedOutSession = await send(alice, '/api/auth/session');
  assert.equal(signedOutSession.data.user, null);
  alice.csrfToken = signedOutSession.data.csrfToken;

  const login = await send(alice, '/api/auth/login', {
    method: 'POST',
    body: { email: 'ALICE@example.com', password: 'a-secure-test-password' }
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.user.email, 'alice@example.com');
  alice.csrfToken = login.data.csrfToken;
});
