import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { ArrowRight, KeyRound, Shuffle, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Attachment, Share } from '../shared/types';
import { api, uploadAttachment } from './api';
import { fileSize } from './fileSize';
import { copyCreatedShare } from './shareClipboard';
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
import { Card, CardHeader, CardPanel, CardTitle } from './ui/card';
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from './ui/dialog';
import { Field, FieldDescription, FieldLabel } from './ui/field';
import { Form } from './ui/form';
import { Input } from './ui/input';
import { Progress } from './ui/progress';
import { SegmentedControl, SegmentedControlItem } from './ui/segmented-control';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';

export type CreatedShare = { share: Share; copied: Promise<boolean> };

export default function ShareEditor({
  share,
  close: onClose,
  saved: onSaved,
  finalFocus,
}: {
  share: Share | 'new';
  close: () => void;
  saved: (created?: CreatedShare, cleanupPending?: boolean) => void;
  finalFocus: () => HTMLElement | null;
}) {
  const existing = share !== 'new';
  const [open, setOpen] = useState(false);
  // Mount closed so Base UI runs its enter transition when this opens.
  useEffect(() => setOpen(true), []);
  const [discard, setDiscard] = useState(false);
  const afterClose = useRef<(() => void) | null>(null);
  const discardConfirmed = useRef(false);
  const focusBeforeDiscard = useRef<HTMLElement | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const continueEditing = useRef<HTMLButtonElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const staged = useRef<{ file: File; attachment: Attachment } | null>(null);
  const cancelUpload = useRef<(() => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(existing ? share.title : '');
  const [body, setBody] = useState(existing ? share.body : '');
  const [code, setCode] = useState('');
  const [enabled, setEnabled] = useState(existing ? share.enabled : true);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const storedAttachment = existing ? share.attachment : null;
  const visibleAttachment = file ?? (removeAttachment ? null : storedAttachment);
  const bodyBytes = new TextEncoder().encode(body).length;
  const dirty =
    title !== (existing ? share.title : '') ||
    body !== (existing ? share.body : '') ||
    enabled !== (existing ? share.enabled : true) ||
    code !== '' ||
    !!file ||
    removeAttachment;

  useEffect(() => () => cancelUpload.current?.(), []);

  function discardStaged() {
    const previous = staged.current;
    staged.current = null;
    if (!previous) return;
    // Server-side sweep still reclaims abandoned uploads if this request cannot complete.
    void fetch('/api/admin/attachments/' + encodeURIComponent(previous.attachment.id), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-TextRelay-Request': '1' },
      body: '{}',
    }).catch(() => {});
  }

  function dismiss(action: () => void) {
    if (!open || afterClose.current) return;
    afterClose.current = action;
    setOpen(false);
  }

  function close() {
    discardStaged();
    dismiss(onClose);
  }

  function saved(created?: CreatedShare, cleanupPending?: boolean) {
    dismiss(() => onSaved(created, cleanupPending));
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !open) return;
    setError('');
    if (!body && !visibleAttachment) {
      setError('请填写正文或选择一个附件');
      return;
    }
    if (file && (file.size === 0 || file.size >= 800000000)) {
      setError('附件不能是空文件，且必须小于 800 MB');
      return;
    }
    if (bodyBytes > 102400) {
      setError('正文超过 100 KiB，请缩短后保存');
      return;
    }
    setBusy(true);
    try {
      let attachmentId: string | null | undefined = removeAttachment ? null : undefined;
      if (file) {
        if (staged.current?.file !== file) {
          setProgress(0);
          const upload = uploadAttachment(file, setProgress);
          cancelUpload.current = upload.cancel;
          try {
            staged.current = { file, attachment: await upload.result };
          } finally {
            cancelUpload.current = null;
            setProgress(null);
          }
        }
        attachmentId = staged.current.attachment.id;
      }
      const attachmentUpdate = attachmentId === undefined ? {} : { attachmentId };
      if (existing) {
        const updated = await api<Share>(
          '/admin/shares/' + share.id,
          { title, body, enabled, version: share.version, ...attachmentUpdate },
          'PATCH',
        );
        staged.current = null;
        saved(undefined, updated.cleanupPending);
      } else {
        const creation = api<Share>('/admin/shares', {
          title,
          body,
          enabled,
          ...(manual ? { code } : {}),
          ...attachmentUpdate,
        });
        const copied = copyCreatedShare(creation);
        const created = await creation;
        staged.current = null;
        saved({ share: created, copied });
      }
    } catch (e) {
      const message = (e as Error).message;
      if (staged.current && message.includes('暂存已过期')) {
        discardStaged();
        setError('附件暂存已过期，重新保存即可再次上传。');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) return;
        if (busy || discard || afterClose.current) {
          details.cancel();
          return;
        }
        if (dirty) {
          details.cancel();
          const active = document.activeElement;
          focusBeforeDiscard.current = active instanceof HTMLElement ? active : null;
          setDiscard(true);
          return;
        }
        close();
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (nextOpen) return;
        const callback = afterClose.current;
        afterClose.current = null;
        callback?.();
      }}
    >
      <DialogPopup
        className="share-dialog max-h-[min(51.25rem,calc(100dvh-2rem))] max-w-5xl"
        bottomStickOnMobile={false}
        initialFocus={titleInput}
        finalFocus={finalFocus}
        showCloseButton={false}
      >
        <DialogHeader className="drawer-header shrink-0 flex-row items-center justify-between gap-3 max-sm:px-4 max-sm:pt-3 max-sm:pb-2">
          <DialogTitle>{existing ? '编辑分享' : '新建分享'}</DialogTitle>
          <DialogClose
            aria-label="关闭编辑"
            disabled={busy || !open}
            render={<Button size="icon" variant="ghost" />}
          >
            <X aria-hidden="true" />
          </DialogClose>
        </DialogHeader>
        <Form className="contents" onSubmit={save} inert={!open}>
          <DialogPanel className="drawer-body min-w-0 max-sm:px-4 max-sm:pb-3">
            <div className="grid min-w-0 items-start gap-5 max-sm:gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="min-w-0 space-y-5 max-sm:space-y-3 max-sm:[&>[data-slot=field]]:gap-1.5">
                <Field disabled={busy}>
                  <FieldLabel>
                    标题{' '}
                    <span className="text-muted-foreground font-normal text-xs">
                      随分享信息复制
                    </span>
                  </FieldLabel>
                  <Input
                    id="title"
                    type="text"
                    ref={titleInput}
                    placeholder="给这段文字起个名字"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    required
                  />
                </Field>
                <Field disabled={busy}>
                  <FieldLabel className="w-full justify-between">
                    正文{' '}
                    <span className="text-muted-foreground font-normal text-xs tabular-nums">
                      {(bodyBytes / 1024).toFixed(1)} / 100 KiB
                    </span>
                  </FieldLabel>
                  <Textarea
                    id="body"
                    rows={8}
                    className="[&_[data-slot=textarea]]:[field-sizing:fixed] max-sm:[&_[data-slot=textarea]]:h-38 max-sm:[&_[data-slot=textarea]]:overflow-y-auto sm:[&_[data-slot=textarea]]:min-h-44 lg:[&_[data-slot=textarea]]:min-h-64"
                    placeholder="写下或粘贴你想传递的文字…"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    spellCheck={false}
                    disabled={busy}
                  />
                </Field>
                <Field disabled={busy}>
                  <FieldLabel>
                    附件{' '}
                    <span className="text-muted-foreground font-normal text-xs">
                      可选 · 小于 800 MB
                    </span>
                  </FieldLabel>
                  <Input
                    id="share-file"
                    ref={fileInput}
                    type="file"
                    accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.pdf,.zip"
                    onChange={(event) => {
                      const selected = event.currentTarget.files?.[0];
                      if (!selected) return;
                      discardStaged();
                      setFile(selected);
                      setRemoveAttachment(false);
                    }}
                  />
                  <FieldDescription>
                    支持 Word、Excel、PPT、Markdown、TXT、PDF 和 ZIP。
                  </FieldDescription>
                </Field>
                {visibleAttachment && (
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm [overflow-wrap:anywhere]">
                        {visibleAttachment.name}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {fileSize(visibleAttachment.size)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (fileInput.current) fileInput.current.value = '';
                        discardStaged();
                        if (!file) setRemoveAttachment(true);
                        setFile(null);
                      }}
                    >
                      {file && storedAttachment ? '保留原附件' : '移除附件'}
                    </Button>
                  </div>
                )}
                {removeAttachment && !visibleAttachment && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRemoveAttachment(false)}
                  >
                    保留原附件
                  </Button>
                )}
              </div>
              <Card className="min-w-0" render={<section aria-labelledby="share-settings" />}>
                <CardHeader className="max-sm:px-3 max-sm:pt-3 max-sm:pb-2">
                  <CardTitle className="text-base" id="share-settings" render={<h3 />}>
                    分享设置
                  </CardTitle>
                </CardHeader>
                <CardPanel className="min-w-0 space-y-4 max-sm:space-y-3 max-sm:px-3 max-sm:pb-3">
                  <Field className="flex-row items-center justify-between gap-3" disabled={busy}>
                    <div className="space-y-1.5">
                      <FieldLabel>启用分享</FieldLabel>
                      <FieldDescription>
                        {enabled ? '知道访问码的人可以取件' : '访客暂时无法查看，访问码仍被保留'}
                      </FieldDescription>
                    </div>
                    <Switch checked={enabled} onCheckedChange={setEnabled} />
                  </Field>
                  {existing ? (
                    <div className="existing-code space-y-1.5">
                      <p className="font-medium text-sm">访问码</p>
                      <code className="font-mono text-sm tracking-wider">{share.code}</code>
                      <p className="text-muted-foreground text-xs">
                        可在列表的更多操作中更换访问码。
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <SegmentedControl
                        aria-label="访问码生成方式"
                        className="max-w-full"
                        render={
                          <RadioGroup
                            value={manual ? 'manual' : 'auto'}
                            disabled={busy}
                            onValueChange={(value) => setManual(value === 'manual')}
                          />
                        }
                      >
                        <SegmentedControlItem render={<Radio.Root value="auto" />}>
                          <Shuffle className="max-sm:hidden" aria-hidden="true" />
                          自动生成
                        </SegmentedControlItem>
                        <SegmentedControlItem render={<Radio.Root value="manual" />}>
                          <KeyRound className="max-sm:hidden" aria-hidden="true" />
                          自定义
                        </SegmentedControlItem>
                      </SegmentedControl>
                      {manual ? (
                        <Field disabled={busy}>
                          <FieldLabel className="flex-wrap">
                            访问码{' '}
                            <span className="text-muted-foreground font-normal text-xs">
                              四位字母或数字，区分大小写
                            </span>
                          </FieldLabel>
                          <Input
                            id="new-code"
                            className="font-mono tracking-widest"
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            pattern="[A-Za-z0-9]{4}"
                            minLength={4}
                            maxLength={4}
                            autoCapitalize="none"
                            autoCorrect="off"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="例如 Ab12"
                            required
                          />
                        </Field>
                      ) : (
                        <p className="text-muted-foreground text-xs">
                          保存时生成一个尚未使用的四位访问码。
                        </p>
                      )}
                    </div>
                  )}
                  <p className="text-muted-foreground text-xs">请勿用四位码分享敏感资料。</p>
                </CardPanel>
              </Card>
            </div>
          </DialogPanel>
          <DialogFooter className="drawer-footer shrink-0 flex-col max-sm:px-4 max-sm:py-3 sm:flex-col">
            {error && (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {progress !== null && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Progress value={progress} aria-label="附件上传进度" />
                <span className="text-muted-foreground text-xs" role="status">
                  {progress === 100 ? '正在确认附件…' : '已上传 ' + progress + '%'}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="max-sm:min-h-11"
                  onClick={() => cancelUpload.current?.()}
                >
                  取消上传
                </Button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <DialogClose
                render={
                  <Button className="secondary max-sm:min-h-11" variant="outline" disabled={busy} />
                }
              >
                取消
              </DialogClose>
              <Button className="primary max-sm:min-h-11" type="submit" loading={busy}>
                {existing ? '保存更改' : '创建分享'} <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </DialogFooter>
        </Form>
      </DialogPopup>
      <AlertDialog
        open={discard}
        onOpenChange={setDiscard}
        onOpenChangeComplete={(nextOpen) => {
          if (nextOpen || !discardConfirmed.current) return;
          close();
        }}
      >
        <AlertDialogPopup
          bottomStickOnMobile={false}
          initialFocus={continueEditing}
          finalFocus={() => {
            if (discardConfirmed.current) return false;
            const previous = focusBeforeDiscard.current;
            return previous?.isConnected ? previous : titleInput.current;
          }}
          aria-describedby="discard-description"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription id="discard-description">
              放弃后，本次未保存的修改将无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button className="secondary" ref={continueEditing} variant="outline" />}
            >
              继续编辑
            </AlertDialogClose>
            <Button
              className="danger-button"
              type="button"
              variant="destructive"
              onClick={() => {
                discardConfirmed.current = true;
                setDiscard(false);
              }}
            >
              放弃更改
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Dialog>
  );
}
