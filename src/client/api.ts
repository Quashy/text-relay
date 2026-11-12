export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch('/api' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers:
      body === undefined ? {} : { 'Content-Type': 'application/json', 'X-TextRelay-Request': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error('服务暂时不可用，请稍后重试');
  }
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/admin/')) location.assign('/manage/login');
    throw Error(data.message ?? '操作未完成，请重试');
  }
  return data;
}
