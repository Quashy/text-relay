import type { Attachment } from '../shared/types';

export function uploadAttachment(file: File, onProgress: (value: number) => void) {
  const request = new XMLHttpRequest();
  const result = new Promise<Attachment>((resolve, reject) => {
    request.open('POST', '/api/admin/attachments');
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-TextRelay-Request', '1');
    request.setRequestHeader('X-TextRelay-Filename', encodeURIComponent(file.name));
    request.responseType = 'json';
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.floor((100 * event.loaded) / event.total));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300 && request.response?.id) {
        resolve(request.response);
        return;
      }
      if (request.status === 401) location.assign('/manage/login');
      reject(
        Error(
          request.response?.message ??
            (request.status === 413 ? '附件必须小于 800 MB' : '附件上传未完成，请重试'),
        ),
      );
    };
    request.onerror = () => reject(Error('网络连接中断，请重试上传'));
    request.onabort = () => reject(Error('已取消上传'));
    request.send(file);
  });
  return { result, cancel: () => request.abort() };
}

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
