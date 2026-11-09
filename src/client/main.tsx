import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  Plus,
  Search,
  X,
  Shuffle,
  LogOut,
  KeyRound,
  FileText,
  MoreHorizontal,
  Radio,
  Clock,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Trash2,
  LoaderCircle,
  ShieldCheck,
  Github,
} from 'lucide-react';
import type { Share, ShareList } from '../shared/types';
import './style.css';
async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
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
function Mark() {
  return (
    <span className="brand-mark">
      <ArrowUpRight size={23} strokeWidth={2.8} />
    </span>
  );
}
function Brand() {
  return (
    <a className="brand" href="/">
      <Mark />
      <span>
        TextRelay<span className="brand-dot">.</span>
      </span>
    </a>
  );
}
function RepositoryLink() {
  return (
    <a
      className="github-link"
      href="https://github.com/Quashy/text-relay"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="GitHub 仓库（在新标签页打开）"
      title="GitHub 仓库（在新标签页打开）"
    >
      <Github size={18} aria-hidden="true" />
      <span className="link-label">GitHub</span>
    </a>
  );
}
function Spinner() {
  return <LoaderCircle className="spin" size={17} />;
}
function Footer() {
  return (
    <footer>
      <span>少一点步骤，多一点连接。</span>
      <div className="footer-links">
        <span>TextRelay · 让文字轻松抵达</span>
        <RepositoryLink />
      </div>
    </footer>
  );
}
function App() {
  return location.pathname.startsWith('/manage') ? <Manage /> : <Public />;
}
function Public() {
  const [code, setCode] = useState(''),
    [body, setBody] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(false);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (copyError) {
      fallbackRef.current?.focus();
      fallbackRef.current?.select();
    }
  }, [copyError]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^[A-Za-z0-9]{4}$/.test(code.trim())) {
      setError('请输入恰好四位字母或数字，注意大小写');
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ body: string }>('/share/resolve', { code: code.trim() });
      setBody(r.body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(body!);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <div className="public-layout">
      <header className="site-header">
        <Brand />
        <nav className="header-nav" aria-label="主要导航">
          <RepositoryLink />
          <a className="subtle-link" href="/manage">
            管理后台 <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </nav>
      </header>
      <main className={body === null ? 'landing' : 'reading'}>
        {body === null ? (
          <>
            <div className="landing-copy">
              <div className="eyebrow">
                <span className="live-dot" /> A SMALL CODE. A SIMPLE CONNECTION.
              </div>
              <h1>
                让文字，
                <br />
                <span>轻松抵达。</span>
              </h1>
              <p className="intro">
                无需账号，无需多余步骤。
                <br />
                输入四位访问码，接收属于你的那段文字。
              </p>
            </div>
            <div className="landing-access">
              <section className="access-card">
                <div className="card-caption">
                  <span>接收一段文字</span>
                  <span className="caption-step">01 / RECEIVE</span>
                </div>
                <form onSubmit={submit}>
                  <label htmlFor="access-code">
                    访问码 <span>区分大小写</span>
                  </label>
                  <div className={'code-field ' + (error ? 'invalid' : '')}>
                    <KeyRound size={21} />
                    <input
                      id="access-code"
                      name="code"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value);
                        setError('');
                      }}
                      placeholder="Ab12"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="off"
                      maxLength={100}
                      aria-describedby="code-hint"
                      aria-invalid={!!error}
                    />
                    <span>4 位</span>
                  </div>
                  <p id="code-hint" className="field-hint">
                    由英文字母与数字组成，保留原有大小写
                  </p>
                  <button className="primary wide" disabled={busy}>
                    {busy ? (
                      <Spinner />
                    ) : (
                      <>
                        查看内容 <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                  <div className="error" role="alert">
                    {error}
                  </div>
                </form>
                <div className="card-bottom">
                  <ShieldCheck size={15} />
                  <span>只显示与你的访问码对应的内容</span>
                </div>
              </section>
              <div className="landing-note">
                <span>01 输入访问码</span>
                <i />
                <span>02 查看文字</span>
                <i />
                <span>03 一键复制</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="reading-heading">
              <button
                className="text-button"
                onClick={() => {
                  setBody(null);
                  setCode('');
                  setCopyError(false);
                }}
              >
                <ArrowLeft size={17} />
                返回首页
              </button>
              <span className="eyebrow">YOUR TEXT, DELIVERED.</span>
            </div>
            <section className="reader-card">
              <div className="reader-toolbar">
                <div>
                  <span className="reader-icon">
                    <FileText size={20} />
                  </span>
                  <div>
                    <h1>文字已抵达</h1>
                    <p>保留原样，随时复制</p>
                  </div>
                </div>
                <button className="primary" onClick={copy}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
                  {copied ? '已复制' : '复制全文'}
                </button>
              </div>
              {copyError && (
                <p className="notice" role="status">
                  自动复制未成功，已为你选中文字，请手动复制。
                </p>
              )}
              <pre className="plain-text">{body}</pre>
              {copyError && (
                <textarea
                  ref={fallbackRef}
                  className="fallback-copy"
                  aria-label="手动复制正文"
                  readOnly
                  value={body}
                />
              )}
              <div className="reader-meta">
                <span className="live-dot" />
                纯文本 · {new TextEncoder().encode(body).length.toLocaleString()} 字节
                <span>格式已保留</span>
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
function Manage() {
  const [checking, setChecking] = useState(true),
    [user, setUser] = useState(''),
    [auth, setAuth] = useState(false),
    [loginError, setLoginError] = useState(''),
    [busy, setBusy] = useState(false);
  const [list, setList] = useState<ShareList>({ items: [], total: 0, page: 1, pages: 1 }),
    [q, setQ] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  const requestSequence = useRef(0);
  const filters = useRef({ q, status, page });
  filters.current = { q, status, page };
  const [editor, setEditor] = useState<Share | 'new' | null>(null),
    [confirm, setConfirm] = useState<{ type: 'delete' | 'rotate'; share: Share } | null>(null),
    [password, setPassword] = useState(false);
  useEffect(() => {
    api<{ username: string }>('/auth/session')
      .then((r) => {
        setUser(r.username);
        setAuth(true);
        history.replaceState(null, '', '/manage');
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!auth) return;
    requestSequence.current++;
    const timer = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(timer);
      requestSequence.current++;
    };
  }, [auth, q, status, page]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  async function load() {
    const { q, status, page } = filters.current;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      const data = await api<ShareList>('/admin/shares/search', { q, status, page });
      if (sequence === requestSequence.current) {
        setList(data);
        if (data.page !== page) setPage(data.page);
      }
    } catch (e) {
      if (sequence === requestSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setLoginError('');
    try {
      const r = await api<{ username: string }>('/auth/login', {
        username: f.get('username'),
        password: f.get('password'),
      });
      setUser(r.username);
      setAuth(true);
      history.replaceState(null, '', '/manage');
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api('/auth/logout', {});
      setAuth(false);
      setList({ items: [], total: 0, page: 1, pages: 1 });
      location.assign('/manage/login');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function toggle(share: Share) {
    try {
      await api(
        '/admin/shares/' + share.id,
        { version: share.version, enabled: !share.enabled },
        'PATCH',
      );
      setToast(share.enabled ? '分享已停用' : '分享已启用');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (checking)
    return (
      <div className="center-loading">
        <Spinner />
        正在加载
      </div>
    );
  if (!auth)
    return (
      <div className="public-layout">
        <header className="site-header">
          <Brand />
          <nav className="header-nav" aria-label="主要导航">
            <RepositoryLink />
            <a href="/" className="subtle-link">
              <ArrowLeft size={15} aria-hidden="true" /> 返回首页
            </a>
          </nav>
        </header>
        <main className="login-main">
          <div className="eyebrow">YOUR WORDS, WELL ORGANIZED.</div>
          <h1>
            欢迎回来<span className="brand-dot">.</span>
          </h1>
          <p className="intro">登录后，继续管理你的文字分享。</p>
          <section className="access-card login-card">
            <div className="card-caption">
              管理员登录 <KeyRound size={18} />
            </div>
            <form onSubmit={login}>
              <label htmlFor="username">账号</label>
              <input
                className="input"
                id="username"
                name="username"
                autoComplete="username"
                required
                maxLength={100}
              />
              <label htmlFor="password">密码</label>
              <input
                className="input"
                type="password"
                id="password"
                name="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
              <button className="primary wide" disabled={busy}>
                {busy ? (
                  <Spinner />
                ) : (
                  <>
                    登录 <ArrowRight size={17} />
                  </>
                )}
              </button>
              <p className="error" role="alert">
                {loginError}
              </p>
            </form>
          </section>
        </main>
        <Footer />
      </div>
    );
  return (
    <div className="manage-layout">
      <header className="manage-header">
        <Brand />
        <span className="workspace-label">文字工作台</span>
        <div className="account">
          <RepositoryLink />
          <span>
            <span className="avatar">{user.charAt(0).toUpperCase()}</span>
            <span className="account-name">{user}</span>
          </span>
          <button
            className="icon-button"
            aria-label="修改密码"
            title="修改密码"
            onClick={() => setPassword(true)}
          >
            <KeyRound size={18} />
          </button>
          <button className="icon-button" onClick={logout} aria-label="退出登录" title="退出登录">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="dashboard">
        <div className="dashboard-top">
          <div>
            <div className="eyebrow">YOUR TEXT LIBRARY</div>
            <h1>
              文字分享<span className="brand-dot">.</span>
            </h1>
            <p>整理文字，分享灵感，让每段内容都有自己的入口。</p>
          </div>
          <button className="primary" onClick={() => setEditor('new')}>
            <Plus size={18} />
            新建分享
          </button>
        </div>
        <div className="library-toolbar">
          <div className="tabs" role="group" aria-label="分享状态">
            {[
              ['all', '全部分享'],
              ['enabled', '已启用'],
              ['disabled', '已停用'],
            ].map(([v, label]) => (
              <button
                className={status === v ? 'active' : ''}
                key={v}
                onClick={() => {
                  setStatus(v);
                  setPage(1);
                }}
              >
                {label}
                {status === v && <span>{list.total}</span>}
              </button>
            ))}
          </div>
          <label className="search-box">
            <Search size={17} />
            <input
              placeholder="搜索标题、正文或完整访问码"
              aria-label="搜索分享"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            {q && (
              <button aria-label="清空搜索" className="icon-button" onClick={() => setQ('')}>
                <X size={15} />
              </button>
            )}
          </label>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <section className="library">
          <div className="table-head">
            <span>内容</span>
            <span>访问码</span>
            <span>状态</span>
            <span>更新时间</span>
            <span>操作</span>
          </div>
          {loading ? (
            <div className="empty">
              <Spinner />
              <p>正在整理文字…</p>
            </div>
          ) : list.items.length === 0 ? (
            <div className="empty">
              <span className="empty-icon">
                <FileText size={29} />
              </span>
              <h2>{q ? '没有找到相关文字' : '让第一段文字出发'}</h2>
              <p>
                {q ? '换个关键词，或试试完整访问码。' : '创建一个分享，让接收者用四位码轻松打开。'}
              </p>
              {!q && (
                <button className="secondary" onClick={() => setEditor('new')}>
                  <Plus size={16} />
                  新建分享
                </button>
              )}
            </div>
          ) : (
            list.items.map((share) => (
              <article
                className={'share-row ' + (!share.enabled ? 'disabled-row' : '')}
                key={share.id}
              >
                <button className="share-content" onClick={() => setEditor(share)}>
                  <span className="file-icon">
                    <FileText size={21} />
                  </span>
                  <span>
                    <strong>{share.title}</strong>
                    <small>{share.body.replace(/\s+/g, ' ').slice(0, 80)}</small>
                  </span>
                </button>
                <div className="row-code">
                  <span className="mobile-label">访问码</span>
                  <code>{share.code}</code>
                  <button
                    className="icon-button small"
                    aria-label={'复制访问码 ' + share.code}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(share.code);
                        setToast('访问码已复制');
                      } catch {
                        setError('复制未成功，请手动复制访问码');
                      }
                    }}
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <button
                  onClick={() => void toggle(share)}
                  className={'status-pill ' + (share.enabled ? 'enabled' : '')}
                  aria-label={(share.enabled ? '停用' : '启用') + share.title}
                >
                  <span />
                  {share.enabled ? '已启用' : '已停用'}
                </button>
                <time>
                  {new Date(share.updated_at).toLocaleDateString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                  })}
                  <small>
                    {new Date(share.updated_at).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </time>
                <div className="row-actions">
                  <button className="edit-button" onClick={() => setEditor(share)}>
                    编辑 <ArrowUpRight size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={'换码 ' + share.title}
                    title="更换访问码"
                    onClick={() => setConfirm({ type: 'rotate', share })}
                  >
                    <Shuffle size={16} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={'删除 ' + share.title}
                    title="删除分享"
                    onClick={() => setConfirm({ type: 'delete', share })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))
          )}
          <div className="table-footer">
            <span>
              共 {list.total} 段文字 <span className="footer-dot">·</span> 每一段，都值得被妥善传递
            </span>
            <div className="pagination">
              <button
                className="icon-button"
                aria-label="上一页"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {page} / {list.pages}
              </span>
              <button
                className="icon-button"
                aria-label="下一页"
                disabled={page >= list.pages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </section>
        <div className="workspace-note">
          <Radio size={15} />
          <span>分享始于一段文字，连接只需四位代码。</span>
          <a href="/" target="_blank" rel="noreferrer">
            打开接收首页 <ArrowUpRight size={14} />
          </a>
        </div>
      </main>
      <Footer />
      {editor && (
        <Editor
          share={editor}
          close={() => setEditor(null)}
          saved={() => {
            setEditor(null);
            setToast(editor === 'new' ? '分享已创建' : '更改已保存');
            void load();
          }}
        />
      )}
      {confirm && (
        <Confirm
          action={confirm}
          close={() => setConfirm(null)}
          saved={() => {
            setConfirm(null);
            setToast(confirm.type === 'delete' ? '分享已删除' : '访问码已更换');
            void load();
          }}
        />
      )}
      {password && (
        <Password
          close={() => setPassword(false)}
          done={() => {
            setAuth(false);
            setPassword(false);
            setLoginError('密码已更新，请重新登录');
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
let dialogCount = 0;
let originalBodyOverflow = '';
function Dialog({
  children,
  close,
  label,
  drawer = false,
  className = '',
}: {
  children: React.ReactNode;
  close: () => void;
  label: string;
  drawer?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!,
      previousFocus = document.activeElement as HTMLElement | null;
    if (dialogCount === 0) originalBodyOverflow = document.body.style.overflow;
    dialogCount++;
    document.body.style.overflow = 'hidden';
    el.showModal();
    el.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    return () => {
      el.close();
      dialogCount--;
      if (dialogCount === 0) document.body.style.overflow = originalBodyOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <dialog
      className={`${drawer ? 'drawer' : 'modal'} ${className}`.trim()}
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.stopPropagation();
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {children}
    </dialog>
  );
}
function Editor({
  share,
  close,
  saved,
}: {
  share: Share | 'new';
  close: () => void;
  saved: () => void;
}) {
  const existing = share !== 'new';
  const [title, setTitle] = useState(existing ? share.title : ''),
    [body, setBody] = useState(existing ? share.body : ''),
    [code, setCode] = useState(''),
    [enabled, setEnabled] = useState(existing ? share.enabled : true),
    [manual, setManual] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [discard, setDiscard] = useState(false);
  const dirty =
    title !== (existing ? share.title : '') ||
    body !== (existing ? share.body : '') ||
    enabled !== (existing ? share.enabled : true) ||
    code !== '';
  const requestClose = () => {
    if (dirty) setDiscard(true);
    else close();
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (new TextEncoder().encode(body).length > 102400) {
      setError('正文超过 100 KiB，请缩短后保存');
      return;
    }
    setBusy(true);
    try {
      if (existing)
        await api(
          '/admin/shares/' + share.id,
          { title, body, enabled, version: share.version },
          'PATCH',
        );
      else await api('/admin/shares', { title, body, enabled, ...(manual ? { code } : {}) });
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      close={busy ? () => {} : requestClose}
      label={existing ? '编辑分享' : '新建分享'}
      drawer={existing}
      className={existing ? undefined : 'create-dialog'}
    >
      <form onSubmit={save}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">{existing ? 'EDIT YOUR TEXT' : 'SOMETHING WORTH SHARING'}</div>
            <h2>
              {existing ? '编辑分享' : '新建一段分享'}
              <span className="brand-dot">.</span>
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={requestClose}
            disabled={busy}
            aria-label="关闭编辑"
          >
            <X size={21} />
          </button>
        </div>
        <div className="drawer-body">
          <label htmlFor="title">
            标题 <span>仅在后台显示</span>
          </label>
          <input
            id="title"
            data-dialog-initial-focus
            className="input"
            placeholder="给这段文字起个名字"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
            autoFocus
          />
          <label htmlFor="body">
            正文 <span>{(new TextEncoder().encode(body).length / 1024).toFixed(1)} / 100 KiB</span>
          </label>
          <textarea
            id="body"
            className="input body-input"
            placeholder="写下或粘贴你想传递的文字…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            spellCheck={false}
          />
          <div className="form-divider" />
          <label htmlFor="new-code">
            访问码 <span>四位字母或数字，区分大小写</span>
          </label>
          {existing ? (
            <>
              <div className="existing-code">
                <code>{share.code}</code>
                <span>换码请使用列表中的换码按钮</span>
              </div>
            </>
          ) : (
            <>
              <div className="code-mode">
                <button
                  type="button"
                  className={!manual ? 'selected' : ''}
                  onClick={() => setManual(false)}
                >
                  <Shuffle size={16} />
                  自动生成
                </button>
                <button
                  type="button"
                  className={manual ? 'selected' : ''}
                  onClick={() => setManual(true)}
                >
                  <KeyRound size={16} />
                  自定义
                </button>
              </div>
              {manual ? (
                <input
                  className="input custom-code"
                  id="new-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  pattern="[A-Za-z0-9]{4}"
                  minLength={4}
                  maxLength={4}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="例如 Ab12"
                  required
                />
              ) : (
                <p className="field-hint">保存时，为你生成一个尚未使用的四位访问码。</p>
              )}
            </>
          )}
          <label className="toggle-row">
            <div>
              <strong>启用分享</strong>
              <small>
                {enabled ? '知道访问码的人可以查看正文' : '访客暂时无法查看，访问码仍被保留'}
              </small>
            </div>
            <input
              className="switch"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </label>
          <div className="error" role="alert">
            {error}
          </div>
        </div>
        <div className="drawer-footer">
          <button type="button" className="secondary" disabled={busy} onClick={requestClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? (
              <Spinner />
            ) : (
              <>
                {' '}
                {existing ? '保存更改' : '创建分享'} <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </form>
      {discard && (
        <Dialog label="放弃未保存的更改" close={() => setDiscard(false)}>
          <p>有尚未保存的更改，确定放弃吗？</p>
          <button className="secondary" onClick={() => setDiscard(false)}>
            继续编辑
          </button>
          <button className="danger-button" onClick={close}>
            放弃更改
          </button>
        </Dialog>
      )}
    </Dialog>
  );
}
function Confirm({
  action,
  close,
  saved,
}: {
  action: { type: 'delete' | 'rotate'; share: Share };
  close: () => void;
  saved: () => void;
}) {
  const [code, setCode] = useState(''),
    [manual, setManual] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(
        '/admin/shares/' + action.share.id + (action.type === 'rotate' ? '/rotate-code' : ''),
        { version: action.share.version, ...(action.type === 'rotate' && manual ? { code } : {}) },
        action.type === 'delete' ? 'DELETE' : 'POST',
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
      close={busy ? () => {} : close}
      label={action.type === 'delete' ? '删除分享' : '更换访问码'}
    >
      <form onSubmit={submit}>
        <div className="modal-heading">
          <h2>{action.type === 'delete' ? '删除这段分享？' : '更换访问码'}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            disabled={busy}
            aria-label="关闭确认"
          >
            <X size={20} />
          </button>
        </div>
        <p className="modal-description">
          「{action.share.title}」
          {action.type === 'delete'
            ? '将被永久删除，无法在后台恢复。'
            : '当前访问码为 ' + action.share.code + '。'}
        </p>
        <p className="notice">旧码将被释放，重新分配后，知道旧码的人也能查看新内容。</p>
        {action.type === 'rotate' && (
          <>
            <div className="code-mode">
              <button
                type="button"
                className={!manual ? 'selected' : ''}
                onClick={() => setManual(false)}
              >
                随机换码
              </button>
              <button
                type="button"
                className={manual ? 'selected' : ''}
                onClick={() => setManual(true)}
              >
                自定义
              </button>
            </div>
            {manual && (
              <>
                <label htmlFor="rotate-code">新访问码</label>
                <input
                  id="rotate-code"
                  className="input custom-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  pattern="[A-Za-z0-9]{4}"
                  maxLength={4}
                  minLength={4}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                />
              </>
            )}
          </>
        )}
        <p className="error" role="alert">
          {error}
        </p>
        <div className="modal-buttons">
          <button type="button" className="secondary" onClick={close} disabled={busy}>
            取消
          </button>
          <button
            className={action.type === 'delete' ? 'danger-button' : 'primary'}
            disabled={busy}
          >
            {busy ? <Spinner /> : action.type === 'delete' ? '确认删除' : '确认换码'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function Password({ close, done }: { close: () => void; done: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog close={busy ? () => {} : close} label="修改密码">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          if (data.get('new') !== data.get('confirm')) {
            setError('两次新密码不一致');
            return;
          }
          setBusy(true);
          try {
            await api('/auth/password', {
              currentPassword: data.get('current'),
              newPassword: data.get('new'),
            });
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-heading">
          <h2>修改密码</h2>
          <button type="button" className="icon-button" onClick={close} aria-label="关闭改密">
            <X size={20} />
          </button>
        </div>
        <p className="modal-description">更新后，所有已登录设备都需要重新登录。</p>
        <label htmlFor="current">当前密码</label>
        <input
          id="current"
          className="input"
          name="current"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
        />
        <label htmlFor="new-password">新密码（至少 12 位）</label>
        <input
          id="new-password"
          className="input"
          name="new"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
        />
        <label htmlFor="confirm-password">再次输入新密码</label>
        <input
          id="confirm-password"
          className="input"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          maxLength={256}
        />
        <p className="error" role="alert">
          {error}
        </p>
        <div className="modal-buttons">
          <button type="button" className="secondary" onClick={close} disabled={busy}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? <Spinner /> : '保存密码'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
