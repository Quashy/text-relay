import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Share } from '../shared/types';
import { api } from './api';
import { copyShareText } from './shareClipboard';
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
import { Button } from './ui/button';
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
import { Field, FieldLabel } from './ui/field';
import { Form } from './ui/form';
import { Input } from './ui/input';
import { SegmentedControl, SegmentedControlItem } from './ui/segmented-control';
import { Textarea } from './ui/textarea';

type DialogCallbacks = {
  close: () => void;
  finalFocus: () => HTMLElement | null;
};

function useDialogExit() {
  const [open, setOpen] = useState(false);
  // Mount closed so Base UI runs its enter transition when this opens.
  useEffect(() => setOpen(true), []);
  const afterExit = useRef<(() => void) | null>(null);

  function dismiss(action: () => void) {
    if (afterExit.current) return;
    afterExit.current = action;
    setOpen(false);
  }

  function complete(isOpen: boolean) {
    if (!isOpen) afterExit.current?.();
  }

  return { open, dismiss, complete, afterExit };
}

const oldCodeWarning = '旧码将被释放，重新分配后，知道旧码的人也能查看新内容。';

export function ShareCopyFallback({
  text,
  created,
  close,
  copied,
  finalFocus,
}: DialogCallbacks & {
  text: string;
  created: boolean;
  copied: () => void;
}) {
  const dialog = useDialogExit();
  const field = useRef<HTMLTextAreaElement>(null);
  const selectedOnOpen = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  function selectText() {
    field.current?.focus();
    field.current?.select();
  }

  async function retry() {
    setBusy(true);
    const success = await copyShareText(text);
    if (dialog.afterExit.current) return;
    setBusy(false);
    if (success) {
      dialog.dismiss(copied);
    } else {
      setMessage('复制仍未成功，请手动复制下方已选文字。');
      selectText();
    }
  }

  return (
    <Dialog
      open={dialog.open}
      onOpenChange={(open) => {
        if (!open) dialog.dismiss(close);
      }}
      onOpenChangeComplete={dialog.complete}
    >
      <DialogPopup
        initialFocus={field}
        finalFocus={finalFocus}
        closeProps={{ 'aria-label': '关闭复制窗口' }}
      >
        <DialogHeader className="pe-14">
          <DialogTitle>
            <span className={created ? 'sr-only' : undefined}>复制分享信息</span>
            {created && <span aria-hidden="true">分享已创建</span>}
          </DialogTitle>
          <DialogDescription>
            {created && <span className="sr-only">分享已创建。</span>}
            未能写入剪贴板。请重试，或选中下方文字手动复制。
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          <Textarea
            className="font-mono [&_[data-slot=textarea]]:max-h-[50dvh]"
            ref={field}
            value={text}
            readOnly
            rows={3}
            aria-label="手动复制分享信息"
            spellCheck={false}
            onFocus={(event) => {
              if (selectedOnOpen.current) return;
              selectedOnOpen.current = true;
              event.currentTarget.select();
            }}
          />
          <p role="status" className="text-muted-foreground text-sm empty:hidden">
            {message}
          </p>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={!dialog.open} onClick={selectText}>
            全选文字
          </Button>
          <Button loading={busy} disabled={!dialog.open} onClick={retry}>
            重试复制
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function Confirm({
  action,
  close,
  saved,
  finalFocus,
  focusAfterDelete,
  refreshAfterDelete,
}: DialogCallbacks & {
  action: { type: 'delete' | 'rotate'; share: Share };
  saved: (cleanupPending?: boolean) => void;
  focusAfterDelete: () => HTMLElement | null;
  refreshAfterDelete: () => Promise<void>;
}) {
  const dialog = useDialogExit();
  const cancel = useRef<HTMLButtonElement>(null);
  const deleted = useRef(false);
  const deleteError = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState('');
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const deleting = action.type === 'delete';
  const unavailable = busy || !dialog.open;

  useEffect(() => {
    if (error) deleteError.current?.focus();
  }, [error]);

  function handleOpenChange(open: boolean, details: { cancel: () => void }) {
    if (open) return;
    if (busy) details.cancel();
    else dialog.dismiss(close);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable) return;
    setError('');
    setBusy(true);
    try {
      const result = await api<{ cleanupPending?: boolean }>(
        '/admin/shares/' + action.share.id + (deleting ? '' : '/rotate-code'),
        { version: action.share.version, ...(!deleting && manual ? { code } : {}) },
        deleting ? 'DELETE' : 'POST',
      );
      if (deleting) {
        deleted.current = true;
        await refreshAfterDelete();
      }
      dialog.dismiss(() => saved(result.cleanupPending));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (deleting) {
    return (
      <AlertDialog
        open={dialog.open}
        onOpenChange={handleOpenChange}
        onOpenChangeComplete={dialog.complete}
      >
        <AlertDialogPopup
          initialFocus={cancel}
          finalFocus={() => (deleted.current ? focusAfterDelete() : finalFocus())}
        >
          <Form className="flex min-h-0 flex-col" onSubmit={submit}>
            <AlertDialogHeader className="min-h-0 overflow-y-auto overscroll-contain">
              <AlertDialogTitle>删除这段分享？</AlertDialogTitle>
              <AlertDialogDescription className="wrap-anywhere">
                「{action.share.title}」
                {action.share.attachment
                  ? '及服务器上的附件将被删除，无法在后台恢复。'
                  : '将被永久删除，无法在后台恢复。'}
                <span className="mt-2 block">{oldCodeWarning}</span>
              </AlertDialogDescription>
              {error && (
                <Alert ref={deleteError} tabIndex={-1} variant="error" className="text-left">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter className="shrink-0">
              <AlertDialogClose
                ref={cancel}
                disabled={unavailable}
                render={<Button variant="outline" />}
              >
                取消
              </AlertDialogClose>
              <Button type="submit" variant="destructive" loading={busy} disabled={!dialog.open}>
                确认删除
              </Button>
            </AlertDialogFooter>
          </Form>
        </AlertDialogPopup>
      </AlertDialog>
    );
  }

  return (
    <Dialog
      open={dialog.open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={dialog.complete}
    >
      <DialogPopup
        finalFocus={finalFocus}
        closeProps={{ 'aria-label': '关闭确认', disabled: unavailable }}
      >
        <Form className="flex min-h-0 flex-col" onSubmit={submit} noValidate={false}>
          <DialogHeader className="shrink-0 pe-14">
            <DialogTitle>更换访问码</DialogTitle>
            <DialogDescription className="wrap-anywhere">
              「{action.share.title}」当前访问码为 {action.share.code}。
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <Alert role="note" variant="warning">
              <AlertDescription>{oldCodeWarning}</AlertDescription>
            </Alert>
            <SegmentedControl
              aria-label="换码方式"
              render={
                <RadioGroup
                  value={manual ? 'manual' : 'random'}
                  disabled={unavailable}
                  onValueChange={(value) => setManual(value === 'manual')}
                />
              }
            >
              <SegmentedControlItem render={<Radio.Root value="random" />}>
                随机换码
              </SegmentedControlItem>
              <SegmentedControlItem render={<Radio.Root value="manual" />}>
                自定义
              </SegmentedControlItem>
            </SegmentedControl>
            {manual && (
              <Field>
                <FieldLabel>新访问码</FieldLabel>
                <Input
                  id="rotate-code"
                  name="code"
                  className="font-mono"
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value)}
                  pattern="[A-Za-z0-9]{4}"
                  maxLength={4}
                  minLength={4}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={unavailable}
                  required
                />
              </Field>
            )}
            {error && (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </DialogPanel>
          <DialogFooter className="shrink-0">
            <DialogClose disabled={unavailable} render={<Button variant="outline" />}>
              取消
            </DialogClose>
            <Button type="submit" loading={busy} disabled={!dialog.open}>
              确认换码
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}

export function Password({
  close,
  done,
  finalFocus,
}: DialogCallbacks & {
  done: () => void;
}) {
  const dialog = useDialogExit();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unavailable = busy || !dialog.open;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable) return;
    const data = new FormData(event.currentTarget);
    if (data.get('new') !== data.get('confirm')) {
      setError('两次新密码不一致');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api('/auth/password', {
        currentPassword: data.get('current'),
        newPassword: data.get('new'),
      });
      dialog.dismiss(done);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={dialog.open}
      onOpenChange={(open, details) => {
        if (open) return;
        if (busy) details.cancel();
        else dialog.dismiss(close);
      }}
      onOpenChangeComplete={dialog.complete}
    >
      <DialogPopup
        finalFocus={finalFocus}
        closeProps={{ 'aria-label': '关闭改密', disabled: unavailable }}
      >
        <Form className="flex min-h-0 flex-col" onSubmit={submit} noValidate={false}>
          <DialogHeader className="shrink-0 pe-14">
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>更新后，所有已登录设备都需要重新登录。</DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel>当前密码</FieldLabel>
              <Input
                id="current"
                name="current"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
                disabled={unavailable}
              />
            </Field>
            <Field>
              <FieldLabel>新密码（至少 6 位）</FieldLabel>
              <Input
                id="new-password"
                name="new"
                type="password"
                autoComplete="new-password"
                minLength={6}
                maxLength={256}
                required
                disabled={unavailable}
              />
            </Field>
            <Field>
              <FieldLabel>再次输入新密码</FieldLabel>
              <Input
                id="confirm-password"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                maxLength={256}
                disabled={unavailable}
              />
            </Field>
            {error && (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </DialogPanel>
          <DialogFooter className="shrink-0">
            <DialogClose disabled={unavailable} render={<Button variant="outline" />}>
              取消
            </DialogClose>
            <Button type="submit" loading={busy} disabled={!dialog.open}>
              保存密码
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
