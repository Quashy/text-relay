import React, { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, X, UsersRound, ShieldCheck } from 'lucide-react';
import type { UserAccount } from '../shared/types';
import { api } from './api';
import Dialog from './Dialog';

export default function Users() {
  const [users, setUsers] = useState<UserAccount[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [editing, setEditing] = useState<UserAccount | 'new' | null>(null),
    [deleting, setDeleting] = useState<UserAccount | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, []);
  async function load() {
    setLoading(true);
    try {
      const result = await api<{ items: UserAccount[] }>('/admin/users');
      if (active.current) setUsers(result.items);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setLoading(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      await api('/admin/users/' + deleting.id, { version: deleting.version }, 'DELETE');
      setDeleting(null);
      setNotice('账号及其分享已删除');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="users-page" aria-labelledby="users-title">
      <div className="dashboard-top">
        <div>
          <div className="eyebrow">PEOPLE & ACCESS</div>
          <h1 id="users-title">
            用户管理<span className="brand-dot">.</span>
          </h1>
          <p>管理登录账号。每个人只能管理自己的分享，最高管理员也不能查看他人的分享。</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setError('');
            setEditing('new');
          }}
        >
          <Plus size={18} />
          新建用户
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <p className="user-notice" role="status">
        {notice}
      </p>
      {loading ? (
        <p role="status" className="user-loading">
          正在加载用户…
        </p>
      ) : (
        <div className="user-list">
          {users.map((u) => (
            <article className="user-row" key={u.id}>
              <div className="user-identity">
                <span className="avatar">
                  <UsersRound size={18} />
                </span>
                <div>
                  <strong>{u.username}</strong>
                  <p>
                    {u.role === 'superadmin'
                      ? '最高管理员 · 账号受保护'
                      : '普通用户 · 仅管理自己的分享'}
                  </p>
                </div>
              </div>
              <div className="user-actions">
                {u.role === 'superadmin' ? (
                  <span className="protected-user">
                    <ShieldCheck size={16} />
                    不可删除或更名
                  </span>
                ) : (
                  <>
                    <button
                      className="secondary"
                      onClick={() => {
                        setError('');
                        setEditing(u);
                      }}
                    >
                      <Pencil size={15} />
                      编辑用户
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={'删除用户 ' + u.username}
                      onClick={() => {
                        setError('');
                        setDeleting(u);
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <AccountEditor
          account={editing}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            setNotice(editing === 'new' ? '用户已创建' : '账号已更新；该用户需要重新登录');
            void load();
          }}
        />
      )}
      {deleting && (
        <Dialog
          label="删除用户"
          descriptionId="delete-user-description"
          close={() => {
            if (!busy) setDeleting(null);
          }}
          className="confirmation-dialog"
        >
          <div className="confirmation-symbol" aria-hidden="true">
            <Trash2 size={22} />
          </div>
          <h2>删除用户 {deleting.username}？</h2>
          <p className="modal-description" id="delete-user-description">
            将同时永久删除此账号创建的全部分享和登录会话。原分享码立即失效，此操作无法撤销。
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-buttons">
            <button className="secondary" disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </button>
            <button className="danger-button" disabled={busy} onClick={() => void remove()}>
              {busy ? '正在删除…' : '删除账号及分享'}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
function AccountEditor({
  account,
  close,
  saved,
}: {
  account: UserAccount | 'new';
  close: () => void;
  saved: () => void;
}) {
  const existing = account !== 'new';
  const [username, setUsername] = useState(existing ? account.username : ''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false);
  const dirty =
    username !== (existing ? account.username : '') || password !== '' || confirm !== '';
  function requestClose() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else close();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      await api(
        '/admin/users' + (existing ? '/' + account.id : ''),
        {
          username,
          ...(password ? { password } : {}),
          ...(existing ? { version: account.version } : {}),
        },
        existing ? 'PATCH' : 'POST',
      );
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      label={existing ? '编辑用户' : '新建用户'}
      close={requestClose}
      className="account-dialog"
    >
      <form onSubmit={submit}>
        <div className="modal-heading">
          <h2>{existing ? '编辑用户' : '新建用户'}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭用户表单"
            disabled={busy}
            onClick={requestClose}
          >
            <X size={20} />
          </button>
        </div>
        <p className="modal-description">
          普通用户只能管理自己的分享。修改账号后，该用户需要重新登录。
        </p>
        <label htmlFor="account-username">用户名</label>
        <input
          id="account-username"
          data-dialog-initial-focus
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={100}
          autoComplete="off"
          required
        />
        <label htmlFor="account-password">
          {existing ? '新密码（留空保留现有密码）' : '初始密码'}
        </label>
        <input
          id="account-password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          maxLength={256}
          autoComplete="new-password"
          required={!existing}
        />
        <p className="field-hint">密码需要 6–256 个字符</p>
        <label htmlFor="account-confirm">再次输入密码</label>
        <input
          id="account-confirm"
          className="input"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          maxLength={256}
          autoComplete="new-password"
          required={!existing || password.length > 0}
        />
        <p className="error" role="alert">
          {error}
        </p>
        <div className="modal-buttons">
          <button type="button" className="secondary" disabled={busy} onClick={requestClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? '正在保存…' : '保存用户'}
          </button>
        </div>
      </form>
      {discard && (
        <Dialog
          label="放弃用户更改"
          close={() => setDiscard(false)}
          className="confirmation-dialog"
        >
          <h2>放弃未保存的更改？</h2>
          <p className="modal-description">本次账号修改尚未保存。</p>
          <div className="modal-buttons">
            <button className="secondary" onClick={() => setDiscard(false)}>
              继续编辑
            </button>
            <button className="danger-button" onClick={close}>
              放弃更改
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
