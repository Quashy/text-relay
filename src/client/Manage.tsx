import { CSPProvider } from '@base-ui/react/csp-provider';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  KeyRound,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type PropsWithChildren } from 'react';
import type { Share, ShareList } from '../shared/types';
import { api } from './api';
import { Brand, RepositoryLink } from './Brand';
import ShareEditor from './ShareEditor';
import { Confirm, Password, ShareCopyFallback } from './ShareDialogs';
import { shareMessage, copyShareText } from './shareClipboard';
import { Alert, AlertDescription } from './ui/alert';
import { Avatar, AvatarFallback } from './ui/avatar';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Card, CardFrame, CardFrameFooter, CardPanel } from './ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './ui/empty';
import { Field, FieldLabel } from './ui/field';
import { Form } from './ui/form';
import { Input } from './ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from './ui/menu';
import { Pagination, PaginationContent, PaginationItem, PaginationLink } from './ui/pagination';
import { SegmentedControl, SegmentedControlItem } from './ui/segmented-control';
import { Spinner } from './ui/spinner';
import { Switch } from './ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tabs, TabsList, TabsPanel, TabsTab } from './ui/tabs';
import Users from './Users';

const shareStatuses = [
  { value: 'all', label: '全部分享' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已停用' },
] as const;
type ShareStatus = (typeof shareStatuses)[number]['value'];
type CopySource =
  | { created: true; opener: HTMLElement | null }
  | { created: false; shareId: string };

function ManageHeader({ children }: PropsWithChildren) {
  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
        <Brand />
        <nav className="flex min-w-0 items-center gap-1 sm:gap-2" aria-label="后台导航">
          <RepositoryLink
            className={buttonVariants({
              variant: 'ghost',
              className: 'px-2 text-sm max-sm:[&_.link-label]:hidden',
            })}
          />
          {children}
        </nav>
      </div>
    </header>
  );
}

function ErrorAlert({ children }: PropsWithChildren) {
  return (
    <Alert variant="error">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export default function Manage() {
  const [checking, setChecking] = useState(true),
    [user, setUser] = useState(''),
    [role, setRole] = useState<'superadmin' | 'user'>('user'),
    [view, setView] = useState<'shares' | 'users'>('shares'),
    [auth, setAuth] = useState(false),
    [loginError, setLoginError] = useState(''),
    [busy, setBusy] = useState(false);
  const [list, setList] = useState<ShareList>({ items: [], total: 0, page: 1, pages: 1 }),
    [q, setQ] = useState(''),
    [status, setStatus] = useState<ShareStatus>('all'),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [cleanupNotice, setCleanupNotice] = useState('');
  const [copyFallback, setCopyFallback] = useState<({ text: string } & CopySource) | null>(null);
  const copySequence = useRef(0);
  const newShareButton = useRef<HTMLButtonElement>(null);
  const editorOpener = useRef<HTMLElement | null>(null);
  const actionOpener = useRef<HTMLElement | null>(null);
  const passwordOpener = useRef<HTMLElement | null>(null);
  function reportCopy(text: string, result: Promise<boolean>, source: CopySource) {
    const { created } = source;
    const sequence = ++copySequence.current;
    if (created) setToast('分享已创建，正在复制链接和访问码…');
    void result.then((copied) => {
      if (sequence !== copySequence.current) return;
      if (copied) {
        setCopyFallback(null);
        setToast(created ? '分享已创建，链接和访问码已复制' : '链接和访问码已复制');
      } else {
        setToast('');
        setCopyFallback({ text, ...source });
      }
    });
  }
  const requestSequence = useRef(0);
  const filters = useRef({ q, status, page });
  filters.current = { q, status, page };
  const [editor, setEditor] = useState<Share | 'new' | null>(null),
    [confirm, setConfirm] = useState<{ type: 'delete' | 'rotate'; share: Share } | null>(null),
    [password, setPassword] = useState(false);

  function restoreFocus(opener: HTMLElement | null) {
    return opener?.isConnected ? opener : newShareButton.current;
  }
  function restoreCopyFocus(source: CopySource) {
    if (source.created) return restoreFocus(source.opener);
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      `[data-copy-share="${CSS.escape(source.shareId)}"]`,
    );
    return (
      Array.from(buttons).find((button) => button.getClientRects().length > 0) ??
      newShareButton.current
    );
  }
  function openEditor(share: Share | 'new', opener: HTMLElement) {
    editorOpener.current = opener;
    setEditor(share);
  }
  function openShareAction(type: 'rotate' | 'delete', share: Share, triggerId: string) {
    actionOpener.current = document.getElementById(triggerId);
    setConfirm({ type, share });
  }
  useEffect(() => {
    api<{ username: string; role: 'superadmin' | 'user' }>('/auth/session')
      .then((r) => {
        setUser(r.username);
        setRole(r.role);
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
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setLoginError('');
    try {
      const r = await api<{ username: string; role: 'superadmin' | 'user' }>('/auth/login', {
        username: f.get('username'),
        password: f.get('password'),
      });
      setUser(r.username);
      setRole(r.role);
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
      <div
        className="flex min-h-dvh items-center justify-center gap-2 text-muted-foreground"
        role="status"
      >
        <Spinner className="size-4" aria-hidden="true" />
        正在加载
      </div>
    );

  if (!auth)
    return (
      <div className="flex min-h-dvh flex-col">
        <ManageHeader>
          <Button variant="ghost" className="px-2 text-sm" render={<a href="/" />}>
            <ArrowLeft aria-hidden="true" /> 返回首页
          </Button>
        </ManageHeader>
        <main className="flex flex-1 flex-col items-center gap-6 px-4 pt-12 pb-10 sm:gap-8 sm:pt-20">
          <div className="space-y-3 text-center">
            <h1 id="login-title" className="font-semibold text-3xl tracking-tight sm:text-5xl">
              账号登录
            </h1>
            <p className="text-muted-foreground text-sm sm:text-base">登录后，继续管理你的分享。</p>
          </div>
          <Card
            className="access-card login-card w-full min-w-0 max-w-sm"
            render={<section aria-labelledby="login-title" />}
          >
            <CardPanel className="p-4 sm:p-6">
              <Form className="flex w-full flex-col gap-4" onSubmit={login}>
                <Field>
                  <FieldLabel>账号</FieldLabel>
                  <Input
                    id="username"
                    className="[&_[data-slot=input]]:h-11"
                    name="username"
                    type="text"
                    autoComplete="username"
                    required
                    maxLength={100}
                  />
                </Field>
                <Field>
                  <FieldLabel>密码</FieldLabel>
                  <Input
                    id="password"
                    className="[&_[data-slot=input]]:h-11"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={256}
                  />
                </Field>
                {loginError && <ErrorAlert>{loginError}</ErrorAlert>}
                <Button className="primary w-full" type="submit" size="xl" loading={busy}>
                  登录 <ArrowRight aria-hidden="true" />
                </Button>
              </Form>
            </CardPanel>
          </Card>
        </main>
      </div>
    );

  const sharesView = (
    <section className="space-y-4" aria-labelledby="shares-title">
      <div className="dashboard-top flex flex-wrap items-center justify-between gap-3">
        <h1 id="shares-title" className="font-semibold text-2xl tracking-tight sm:text-3xl">
          我的分享
        </h1>
        <Button
          className="primary"
          ref={newShareButton}
          onClick={(event) => openEditor('new', event.currentTarget)}
        >
          <Plus aria-hidden="true" /> 新建分享
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          render={
            <RadioGroup
              aria-label="分享状态"
              value={status}
              onValueChange={(value: ShareStatus) => {
                setStatus(value);
                setPage(1);
              }}
            />
          }
        >
          {shareStatuses.map(({ value, label }) => (
            <SegmentedControlItem
              key={value}
              className="text-muted-foreground"
              render={<Radio.Root value={value} />}
            >
              {label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <InputGroup className="max-w-sm">
          <InputGroupInput
            type="text"
            placeholder="搜索标题、正文或完整访问码"
            aria-label="搜索分享"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <InputGroupAddon className="text-muted-foreground">
            <Search aria-hidden="true" />
          </InputGroupAddon>
          {q && (
            <InputGroupAddon align="inline-end">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="清空搜索"
                onClick={() => {
                  setQ('');
                  setPage(1);
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
      {cleanupNotice && (
        <Alert variant="info" role="status">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{cleanupNotice}</AlertDescription>
        </Alert>
      )}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <CardFrame className="library min-w-0" aria-busy={loading}>
        {loading && list.items.length === 0 ? (
          <Card>
            <Empty className="gap-2" role="status">
              <Spinner className="size-5" aria-hidden="true" />
              <span className="text-muted-foreground text-sm">正在加载分享</span>
            </Empty>
          </Card>
        ) : list.items.length === 0 ? (
          <Card>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{q ? '没有找到相关文字' : '暂无分享'}</EmptyTitle>
                <EmptyDescription>
                  {q ? '换个关键词，或试试完整访问码。' : '创建分享后，接收者可用四位访问码取件。'}
                </EmptyDescription>
              </EmptyHeader>
              {!q && status === 'all' && (
                <EmptyContent>
                  <Button
                    variant="outline"
                    onClick={(event) => openEditor('new', event.currentTarget)}
                  >
                    <Plus aria-hidden="true" /> 新建分享
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          </Card>
        ) : (
          <Table variant="card" className="table-fixed" aria-label="分享列表">
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="max-sm:px-2">
                  内容
                </TableHead>
                <TableHead scope="col" className="hidden w-28 sm:table-cell">
                  访问码
                </TableHead>
                <TableHead scope="col" className="hidden w-24 md:table-cell">
                  状态
                </TableHead>
                <TableHead scope="col" className="hidden w-20 lg:table-cell">
                  更新时间
                </TableHead>
                <TableHead scope="col" className="w-26 max-sm:px-2 sm:w-25 sm:pointer-coarse:w-28!">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((share) => {
                const statusLabel = (share.enabled ? '停用' : '启用') + share.title;
                const actionTriggerId = 'share-actions-' + share.id;
                const statusId = 'share-status-' + share.id;
                const updateTime = new Date(share.updated_at);
                const codeAndCopy = (
                  <div className="row-code flex items-center gap-1">
                    <Badge render={<code />} variant="outline" className="font-mono">
                      {share.code}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="max-sm:min-h-11 max-sm:min-w-11 max-sm:after:hidden"
                      aria-label={'复制分享链接和访问码 ' + share.code}
                      title="复制分享链接和访问码"
                      data-copy-share={share.id}
                      onClick={() => {
                        const text = shareMessage(share);
                        reportCopy(text, copyShareText(text), {
                          created: false,
                          shareId: share.id,
                        });
                      }}
                    >
                      <Copy aria-hidden="true" />
                    </Button>
                  </div>
                );
                return (
                  <TableRow className="share-row lg:[&>td]:py-1" key={share.id}>
                    <TableCell className="min-w-0 max-sm:px-2 max-sm:py-1.5">
                      <Button
                        variant="link"
                        className="h-auto min-h-6 max-w-full justify-start px-0 text-left text-sm whitespace-normal [overflow-wrap:anywhere] max-sm:after:hidden"
                        onClick={(event) => openEditor(share, event.currentTarget)}
                      >
                        {share.title}
                      </Button>
                      {share.body && (
                        <p className="hidden truncate pb-0.5 text-muted-foreground text-xs leading-relaxed sm:block">
                          {share.body.replace(/\s+/g, ' ').slice(0, 80)}
                        </p>
                      )}
                      {share.attachment && (
                        <p className="truncate pb-0.5 text-muted-foreground text-xs leading-relaxed">
                          附件：{share.attachment.name}
                        </p>
                      )}
                      <div className="flex items-center gap-1 md:hidden">
                        <div className="sm:hidden">{codeAndCopy}</div>
                        <Badge variant={share.enabled ? 'success' : 'secondary'} size="sm">
                          {share.enabled ? '已启用' : '已停用'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{codeAndCopy}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={share.enabled}
                          aria-label={'分享状态：' + share.title}
                          aria-describedby={statusId}
                          onCheckedChange={() => void toggle(share)}
                        />
                        <span id={statusId} className="text-muted-foreground text-xs">
                          {share.enabled ? '已启用' : '已停用'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <time
                        dateTime={updateTime.toISOString()}
                        className="text-muted-foreground text-xs"
                      >
                        {updateTime.toLocaleDateString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                        })}
                        <span className="mt-1 block">
                          {updateTime.toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </time>
                    </TableCell>
                    <TableCell className="max-sm:px-1!">
                      <div className="flex items-center gap-0.5 max-sm:gap-1 pointer-coarse:gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="edit-button px-1.5 text-sm max-sm:min-h-11 max-sm:min-w-11 max-sm:after:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:after:hidden"
                          onClick={(event) => openEditor(share, event.currentTarget)}
                        >
                          编辑
                        </Button>
                        <Menu>
                          <MenuTrigger
                            id={actionTriggerId}
                            aria-label={'更多操作 ' + share.title}
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="max-sm:min-h-11 max-sm:min-w-11 max-sm:after:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:after:hidden"
                              />
                            }
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </MenuTrigger>
                          <MenuPopup align="end">
                            <MenuItem
                              className="md:hidden"
                              aria-label={statusLabel}
                              onClick={() => void toggle(share)}
                            >
                              {share.enabled ? '停用分享' : '启用分享'}
                            </MenuItem>
                            <MenuItem
                              aria-label={'换码 ' + share.title}
                              onClick={() => openShareAction('rotate', share, actionTriggerId)}
                            >
                              <Shuffle aria-hidden="true" /> 更换访问码
                            </MenuItem>
                            <MenuItem
                              variant="destructive"
                              aria-label={'删除 ' + share.title}
                              onClick={() => openShareAction('delete', share, actionTriggerId)}
                            >
                              <Trash2 aria-hidden="true" /> 删除分享
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <CardFrameFooter className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <span className="text-muted-foreground text-sm">共 {list.total} 条分享</span>
          <Pagination className="mx-0 w-auto" aria-label="分享分页">
            <PaginationContent>
              <PaginationItem>
                <PaginationLink
                  aria-label="上一页"
                  render={<Button variant="ghost" size="icon-sm" disabled={page <= 1} />}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </PaginationLink>
              </PaginationItem>
              <PaginationItem className="px-1 text-muted-foreground text-sm tabular-nums">
                {page} / {list.pages}
              </PaginationItem>
              <PaginationItem>
                <PaginationLink
                  aria-label="下一页"
                  render={<Button variant="ghost" size="icon-sm" disabled={page >= list.pages} />}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </CardFrameFooter>
      </CardFrame>
    </section>
  );

  return (
    <CSPProvider disableStyleElements>
      <div className="flex min-h-dvh flex-col">
        <ManageHeader>
          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <Avatar aria-hidden="true" className="size-7">
              <AvatarFallback>{user.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="max-w-36 truncate text-sm" title={user}>
              {user}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="修改密码"
            title="修改密码"
            onClick={(event) => {
              passwordOpener.current = event.currentTarget;
              setPassword(true);
            }}
          >
            <KeyRound aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="退出登录"
            title="退出登录"
            onClick={logout}
          >
            <LogOut aria-hidden="true" />
          </Button>
        </ManageHeader>
        <main className="dashboard mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-9">
          {role === 'superadmin' ? (
            <Tabs className="gap-5" value={view} onValueChange={setView}>
              <TabsList aria-label="工作区" className="text-muted-foreground">
                <TabsTab value="shares">我的分享</TabsTab>
                <TabsTab value="users">用户管理</TabsTab>
              </TabsList>
              <TabsPanel value="shares">{sharesView}</TabsPanel>
              <TabsPanel value="users">
                <Users />
              </TabsPanel>
            </Tabs>
          ) : (
            sharesView
          )}
        </main>
        {editor && (
          <ShareEditor
            share={editor}
            finalFocus={() => restoreFocus(editorOpener.current)}
            close={() => setEditor(null)}
            saved={(created, cleanupPending) => {
              setEditor(null);
              if (created)
                reportCopy(shareMessage(created.share), created.copied, {
                  created: true,
                  opener: editorOpener.current,
                });
              else if (cleanupPending) setCleanupNotice('更改已保存，旧附件正在等待服务器清理。');
              else setToast('更改已保存');
              void load();
            }}
          />
        )}
        {confirm && (
          <Confirm
            action={confirm}
            finalFocus={() => restoreFocus(actionOpener.current)}
            focusAfterDelete={() => newShareButton.current}
            refreshAfterDelete={load}
            close={() => setConfirm(null)}
            saved={(cleanupPending) => {
              setConfirm(null);
              if (cleanupPending) setCleanupNotice('分享已下线，附件正在等待服务器清理。');
              else setToast(confirm.type === 'delete' ? '分享已删除' : '访问码已更换');
              if (confirm.type === 'rotate') void load();
            }}
          />
        )}
        {password && (
          <Password
            finalFocus={() => restoreFocus(passwordOpener.current)}
            close={() => setPassword(false)}
            done={() => {
              setAuth(false);
              setPassword(false);
              setLoginError('密码已更新，请重新登录');
            }}
          />
        )}
        {copyFallback && (
          <ShareCopyFallback
            text={copyFallback.text}
            created={copyFallback.created}
            finalFocus={() => restoreCopyFocus(copyFallback)}
            close={() => setCopyFallback(null)}
            copied={() => {
              setCopyFallback(null);
              setToast('链接和访问码已复制');
            }}
          />
        )}
        {toast && (
          <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 mx-auto max-w-sm">
            <Alert className="toast bg-popover shadow-sm" variant="success" role="status">
              <Check aria-hidden="true" />
              <AlertDescription>{toast}</AlertDescription>
            </Alert>
          </div>
        )}
      </div>
    </CSPProvider>
  );
}
