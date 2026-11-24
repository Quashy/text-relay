import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { UserAccount } from '../shared/types';
import { api } from './api';
import { Alert, AlertDescription } from './ui/alert';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from './ui/dialog';
import { Field, FieldDescription, FieldLabel } from './ui/field';
import { Form } from './ui/form';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

type AccountAction =
  | { kind: 'edit'; account: UserAccount | 'new'; open: boolean }
  | { kind: 'delete'; account: UserAccount; open: boolean };

export default function Users() {
  const [users, setUsers] = useState<UserAccount[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [action, setAction] = useState<AccountAction | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const active = useRef(true);
  const listRequest = useRef(0);
  const createButton = useRef<HTMLButtonElement>(null);
  const actionTrigger = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, []);

  async function load() {
    const request = ++listRequest.current;
    setLoading(true);
    try {
      const result = await api<{ items: UserAccount[] }>('/admin/users');
      if (active.current && request === listRequest.current) setUsers(result.items);
    } catch (e) {
      if (active.current && request === listRequest.current) setError((e as Error).message);
    } finally {
      if (active.current && request === listRequest.current) setLoading(false);
    }
  }

  function openAction(next: AccountAction, trigger: HTMLButtonElement) {
    if (action) return;
    actionTrigger.current = trigger;
    setError('');
    setAction(next);
  }

  function closeAction() {
    setAction((current) => current && { ...current, open: false });
  }

  function clearClosedAction(open: boolean) {
    if (!open) setAction((current) => (current?.open ? current : null));
  }

  async function remove(account: UserAccount) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ cleanupPending?: boolean }>(
        '/admin/users/' + account.id,
        { version: account.version },
        'DELETE',
      );
      actionTrigger.current = createButton.current;
      closeAction();
      setNotice(
        result.cleanupPending ? '账号和分享已下线，附件正在等待服务器清理。' : '账号及其分享已删除',
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-labelledby="users-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-52">
          <h1 id="users-title" className="font-heading font-semibold text-2xl">
            用户管理
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            管理登录账号。每个人只能管理自己的分享，最高管理员也不能查看他人的分享。
          </p>
        </div>
        <Button
          ref={createButton}
          onClick={(e) => openAction({ kind: 'edit', account: 'new', open: true }, e.currentTarget)}
        >
          <Plus aria-hidden="true" />
          新建用户
        </Button>
      </header>
      {error && action?.kind !== 'delete' && (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert variant="success" role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <Card className="overflow-hidden" aria-busy={loading}>
        {loading && users.length === 0 ? (
          <p className="flex items-center gap-2 p-4 text-muted-foreground text-sm" role="status">
            <Spinner className="size-4 motion-reduce:animate-none" aria-hidden="true" />
            正在加载用户…
          </p>
        ) : (
          <Table className="table-fixed" aria-label="用户列表">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">账号</TableHead>
                <TableHead scope="col" className="w-30 text-right sm:w-44">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="whitespace-normal">
                    <p className="font-medium leading-5 [overflow-wrap:anywhere]">
                      {account.username}
                    </p>
                    <Badge
                      className="mt-1"
                      variant={account.role === 'superadmin' ? 'info' : 'secondary'}
                    >
                      {account.role === 'superadmin' ? '最高管理员' : '普通用户'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {account.role === 'superadmin' ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                        <ShieldCheck className="hidden size-4 sm:block" aria-hidden="true" />
                        不可删除或更名
                      </span>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button
                          className="max-sm:size-11 max-sm:px-0"
                          variant="outline"
                          onClick={(e) =>
                            openAction({ kind: 'edit', account, open: true }, e.currentTarget)
                          }
                        >
                          <Pencil aria-hidden="true" />
                          <span className="max-sm:sr-only">编辑用户</span>
                        </Button>
                        <Button
                          className="max-sm:size-11"
                          variant="destructive-outline"
                          size="icon"
                          aria-label={'删除用户 ' + account.username}
                          onClick={(e) =>
                            openAction({ kind: 'delete', account, open: true }, e.currentTarget)
                          }
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {action?.kind === 'edit' && (
        <AccountEditor
          account={action.account}
          open={action.open}
          finalFocus={actionTrigger}
          close={closeAction}
          onOpenChangeComplete={clearClosedAction}
          saved={() => {
            closeAction();
            setNotice(action.account === 'new' ? '用户已创建' : '账号已更新，该用户需要重新登录');
            void load();
          }}
        />
      )}
      {action?.kind === 'delete' && (
        <AlertDialog
          open={action.open}
          onOpenChange={(open, details) => {
            if (open) return;
            if (busy) details.cancel();
            else closeAction();
          }}
          onOpenChangeComplete={clearClosedAction}
        >
          <AlertDialogPopup
            className="overflow-y-auto"
            initialFocus={cancelDelete}
            finalFocus={actionTrigger}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>删除用户</AlertDialogTitle>
              <AlertDialogDescription className="[overflow-wrap:anywhere]">
                将永久删除「{action.account.username}
                」创建的全部分享和登录会话。原分享码立即失效，此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <Alert className="mx-6 mb-4 w-auto" variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter className="shrink-0">
              <AlertDialogClose
                render={<Button ref={cancelDelete} variant="outline" disabled={busy} />}
              >
                取消
              </AlertDialogClose>
              <Button
                variant="destructive"
                loading={busy}
                onClick={() => void remove(action.account)}
              >
                {busy ? '正在删除…' : '删除账号及分享'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      )}
    </section>
  );
}

function AccountEditor({
  account,
  open,
  finalFocus,
  close,
  saved,
  onOpenChangeComplete,
}: {
  account: UserAccount | 'new';
  open: boolean;
  finalFocus: RefObject<HTMLButtonElement | null>;
  close: () => void;
  saved: () => void;
  onOpenChangeComplete: (open: boolean) => void;
}) {
  const existing = account !== 'new';
  const [username, setUsername] = useState(existing ? account.username : ''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false);
  const usernameInput = useRef<HTMLInputElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const discardAccepted = useRef(false);
  const dirty =
    username !== (existing ? account.username : '') || password !== '' || confirm !== '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
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
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) return;
        if (busy || dirty) details.cancel();
        if (busy) return;
        if (dirty) setDiscard(true);
        else close();
      }}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <DialogPopup
        initialFocus={usernameInput}
        finalFocus={finalFocus}
        closeProps={{ 'aria-label': '关闭用户表单', disabled: busy }}
      >
        <Form className="flex min-h-0 flex-col" onSubmit={submit}>
          <DialogHeader className="shrink-0 pe-14">
            <DialogTitle>{existing ? '编辑用户' : '新建用户'}</DialogTitle>
            <DialogDescription>
              普通用户只能管理自己的分享。修改账号后，该用户需要重新登录。
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel>用户名</FieldLabel>
              <Input
                id="account-username"
                name="username"
                ref={usernameInput}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={100}
                autoComplete="off"
                required
              />
            </Field>
            <Field>
              <FieldLabel>{existing ? '新密码（留空保留现有密码）' : '初始密码'}</FieldLabel>
              <Input
                id="account-password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                maxLength={256}
                autoComplete="new-password"
                required={!existing}
              />
              <FieldDescription>密码需要 6–256 个字符</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>再次输入密码</FieldLabel>
              <Input
                id="account-confirm"
                name="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                maxLength={256}
                autoComplete="new-password"
                required={!existing || password.length > 0}
              />
            </Field>
            {error && (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </DialogPanel>
          <DialogFooter className="shrink-0">
            <DialogClose render={<Button variant="outline" disabled={busy} />}>取消</DialogClose>
            <Button type="submit" loading={busy}>
              {busy ? '正在保存…' : '保存用户'}
            </Button>
          </DialogFooter>
        </Form>
        <AlertDialog
          open={discard}
          onOpenChange={setDiscard}
          onOpenChangeComplete={(nextOpen) => {
            if (!nextOpen && discardAccepted.current) close();
          }}
        >
          <AlertDialogPopup
            className="overflow-y-auto"
            initialFocus={keepEditing}
            finalFocus={() => !discardAccepted.current}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
              <AlertDialogDescription>本次账号修改尚未保存。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="shrink-0">
              <AlertDialogClose render={<Button ref={keepEditing} variant="outline" />}>
                继续编辑
              </AlertDialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  discardAccepted.current = true;
                  setDiscard(false);
                }}
              >
                放弃更改
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </DialogPopup>
    </Dialog>
  );
}
