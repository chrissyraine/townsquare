// Calls the worker's default-exported fetch handler directly — a full HTTP
// round trip through the real routing/auth/DB code, just without an actual
// network hop. `worker` is the module's default export; `env` should come
// from createTestD1() (see d1.js) plus whatever secrets a test needs.
export async function call(worker, env, method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = new Request(`https://gettownsquare.app${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const response = await worker.fetch(request, env);
  let data = null;
  try { data = await response.json(); } catch { /* no/invalid JSON body */ }
  return { status: response.status, data };
}
