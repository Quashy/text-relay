import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, createReadStream, fstatSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { open, rename, statfs } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { FastifyReply } from 'fastify';
import type { Db } from './db.js';

export const ATTACHMENT_MAX_BYTES = 800_000_000;
const DRAFT_TTL = 60 * 60 * 1000;
const LINK_TTL = 30 * 60 * 1000;
const DISK_RESERVE = 128 * 1024 * 1024;
const ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const ALLOWED = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.md',
  '.txt',
  '.pdf',
  '.zip',
]);
export const attachmentIdSchema = { type: ['string', 'null'], pattern: ID.source };

type FileRow = { id: string; name: string; size: number };
type LinkRow = FileRow & { share_id: string; version: number };

export class AttachmentError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function filename(value: string | string[] | undefined) {
  let name = '';
  try {
    name = typeof value === 'string' ? decodeURIComponent(value) : '';
  } catch {}
  if (!name.trim() || name.length > 200 || /[/\\\x00-\x1f\x7f]/.test(name))
    throw new AttachmentError(400, '附件文件名无效');
  if (!ALLOWED.has(extname(name).toLowerCase())) throw new AttachmentError(415, '不支持该附件格式');
  return name;
}
function absent(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export function attachmentStore(
  db: Db,
  now: () => number,
  path?: string,
  cutoff = ATTACHMENT_MAX_BYTES,
) {
  if (!Number.isSafeInteger(cutoff) || cutoff < 2 || cutoff > ATTACHMENT_MAX_BYTES)
    throw Error('Invalid attachment size limit');
  const root = path ? resolve(path) : undefined;
  if (root) mkdirSync(root, { recursive: true, mode: 0o700 });
  const secret = randomBytes(32);
  const uploading = new Set<string>();
  const active = db.prepare(
    "SELECT id,name,size FROM attachments WHERE share_id=? AND state='active'",
  );
  const pending = db.prepare(
    "SELECT id,name,size FROM attachments WHERE id=? AND owner_id=? AND state='ready' AND updated_at>?",
  );
  const forget = db.prepare(
    "UPDATE attachments SET state='deleting',share_id=NULL WHERE share_id=?",
  );
  const seal = db.prepare(
    "UPDATE attachments SET share_id=?,state='active' WHERE id=? AND state='ready'",
  );
  const pendingDeletes = db.prepare(
    "SELECT id FROM attachments WHERE state='deleting' AND owner_id=?",
  );
  const attachmentById = db.prepare(
    "SELECT a.id,a.name,a.size,a.share_id,s.version FROM attachments a JOIN shares s ON a.share_id=s.id WHERE a.id=? AND a.state='active' AND s.enabled=1",
  );
  const makePath = (id: string, temp = false) => {
    if (!root || !ID.test(id)) throw Error('Invalid attachment storage key');
    return join(root, temp ? id + '.part' : id);
  };
  function cleanup(ids: string[]) {
    if (!root) return ids.length === 0;
    let done = true;
    for (const id of ids) {
      if (uploading.has(id)) {
        done = false;
        continue;
      }
      try {
        for (const temp of [true, false]) {
          try {
            unlinkSync(makePath(id, temp));
          } catch (error) {
            if (!absent(error)) throw error;
          }
        }
        db.prepare("DELETE FROM attachments WHERE id=? AND state='deleting'").run(id);
      } catch {
        done = false;
      }
    }
    return done;
  }
  function sweep() {
    if (!root) return;
    const expired = db
      .prepare("SELECT id FROM attachments WHERE state IN ('uploading','ready') AND updated_at<=?")
      .pluck()
      .all(now() - DRAFT_TTL) as string[];
    const mark = db.prepare("UPDATE attachments SET state='deleting' WHERE id=?");
    for (const id of expired) if (!uploading.has(id)) mark.run(id);
    cleanup(
      db.prepare("SELECT id FROM attachments WHERE state='deleting'").pluck().all() as string[],
    );
  }
  function sign(id: string, shareId: string, version: number, expires: number) {
    return createHmac('sha256', secret)
      .update([id, shareId, version, expires].join(':'))
      .digest('hex');
  }
  return {
    root,
    sweep,
    current: (share: string) => active.get(share) as FileRow | undefined,
    staged: (id: string, owner: number) =>
      pending.get(id, owner, now() - DRAFT_TTL) as FileRow | undefined,
    remove: (share: string) => forget.run(share),
    attach: (share: string, id: string) => seal.run(share, id),
    cleanOwner: (owner: number) => cleanup(pendingDeletes.pluck().all(owner) as string[]),
    async upload(
      source: Readable,
      nameHeader: string | string[] | undefined,
      lengthHeader: string | undefined,
      owner: number,
      valid: () => boolean,
    ) {
      if (!root) throw new AttachmentError(503, '未配置附件存储');
      const name = filename(nameHeader);
      const declared = lengthHeader === undefined ? undefined : Number(lengthHeader);
      if (declared !== undefined && declared >= cutoff)
        throw new AttachmentError(413, '单个附件必须小于 800 MB');
      if (uploading.size >= 1) throw new AttachmentError(429, '已有附件正在上传，请稍后重试');
      const id = randomUUID();
      uploading.add(id);
      let size = 0,
        saved = false,
        tracked = false;
      try {
        const fs = await statfs(root);
        const capacity = Math.max(0, fs.bavail * fs.bsize - DISK_RESERVE);
        if (capacity < (declared ?? 1)) throw new AttachmentError(507, '服务器存储空间不足');
        if (!valid()) throw new AttachmentError(401, '登录已过期，请重新登录');
        db.prepare("INSERT INTO attachments VALUES(?,?,0,?,NULL,'uploading',?)").run(
          id,
          name,
          owner,
          now(),
        );
        tracked = true;
        const file = await open(makePath(id, true), 'wx', 0o600);
        try {
          // Do not pipe an HTTP request into a pipeline that destroys its socket on a size rejection.
          for await (const part of source.iterator({ destroyOnReturn: false })) {
            const bytes: Buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
            size += bytes.length;
            if (size >= cutoff) throw new AttachmentError(413, '单个附件必须小于 800 MB');
            if (size > capacity) throw new AttachmentError(507, '服务器存储空间不足');
            for (let offset = 0; offset < bytes.length; ) {
              const result = await file.write(bytes, offset, bytes.length - offset, null);
              if (!result.bytesWritten) throw new AttachmentError(507, '无法继续写入附件');
              offset += result.bytesWritten;
            }
          }
          if (!size || (declared !== undefined && size !== declared))
            throw new AttachmentError(400, '请选择完整的非空文件');
          await file.sync();
        } finally {
          await file.close();
        }
        if (!valid()) throw new AttachmentError(401, '登录已过期，请重新登录');
        await rename(makePath(id, true), makePath(id));
        saved =
          db
            .prepare(
              "UPDATE attachments SET state='ready',size=?,updated_at=? WHERE id=? AND state='uploading'",
            )
            .run(size, now(), id).changes === 1;
        if (!saved) throw new AttachmentError(401, '登录已过期，请重新登录');
        return { id, name, size };
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOSPC')
          throw new AttachmentError(507, '服务器存储空间不足');
        throw error;
      } finally {
        uploading.delete(id);
        if (tracked && !saved) {
          db.prepare("UPDATE attachments SET state='deleting' WHERE id=?").run(id);
          cleanup([id]);
        }
      }
    },
    discard(id: string, owner: number) {
      const changed = db
        .prepare(
          "UPDATE attachments SET state='deleting' WHERE id=? AND owner_id=? AND state='ready'",
        )
        .run(id, owner);
      return changed.changes ? cleanup([id]) : undefined;
    },
    publicInfo(file: FileRow, shareId: string, version: number) {
      const exp = now() + LINK_TTL;
      return {
        name: file.name,
        size: file.size,
        downloadUrl:
          '/api/share/attachment/' +
          file.id +
          '?ticket=' +
          exp +
          '.' +
          sign(file.id, shareId, version, exp),
      };
    },
    download(id: string, ticket: unknown, range: string | undefined, reply: FastifyReply) {
      const match = typeof ticket === 'string' && /^(\d{1,16})\.([a-f0-9]{64})$/.exec(ticket);
      if (!root || !ID.test(id) || !match || Number(match[1]) <= now())
        throw new AttachmentError(404, '附件不可用，请重新输入访问码');
      const row = attachmentById.get(id) as LinkRow | undefined;
      if (
        !row ||
        !timingSafeEqual(
          Buffer.from(match[2], 'hex'),
          Buffer.from(sign(id, row.share_id, row.version, Number(match[1])), 'hex'),
        )
      )
        throw new AttachmentError(404, '附件不可用，请重新输入访问码');
      const invalid = () =>
        reply
          .header('Content-Range', 'bytes */' + row.size)
          .code(416)
          .send({ message: '无法从该位置继续下载' });
      let start = 0,
        end = row.size - 1;
      if (range !== undefined) {
        const bounds = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!bounds || (!bounds[1] && !bounds[2])) return invalid();
        const first = Number(bounds[1]),
          last = Number(bounds[2]);
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return invalid();
        if (bounds[1]) {
          start = first;
          if (bounds[2]) end = Math.min(end, last);
        } else {
          if (!last) return invalid();
          start = Math.max(0, row.size - last);
        }
        if (start > end) return invalid();
      }
      const diskPath = makePath(id);
      // No asynchronous gap from authorization to opening the authorized file.
      let fd: number | undefined;
      try {
        fd = openSync(diskPath, 'r');
        const file = fstatSync(fd);
        if (!file.isFile() || file.size !== row.size) throw Error('Attachment storage mismatch');
      } catch {
        if (fd !== undefined) closeSync(fd);
        throw new AttachmentError(404, '附件文件已不可用');
      }
      const encoded = encodeURIComponent(row.name).replace(
        /['()*]/g,
        (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
      );
      reply
        .header(
          'Content-Disposition',
          'attachment; filename="download' +
            extname(row.name).toLowerCase() +
            "\"; filename*=UTF-8''" +
            encoded,
        )
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', end - start + 1)
        .type('application/octet-stream');
      if (range !== undefined)
        reply.code(206).header('Content-Range', 'bytes ' + start + '-' + end + '/' + row.size);
      if (reply.request.method === 'HEAD') {
        closeSync(fd);
        return reply.send();
      }
      return reply.send(createReadStream(diskPath, { fd, start, end, autoClose: true }));
    },
  };
}
