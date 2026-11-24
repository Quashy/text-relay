import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Copy,
  Download,
} from 'lucide-react';
import type { PublicAttachment } from '../shared/types';
import { api } from './api';
import { Brand, RepositoryLink } from './Brand';
import { fileSize } from './fileSize';
import { Alert, AlertDescription } from './ui/alert';
import { Button, buttonVariants } from './ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from './ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from './ui/field';
import { Form } from './ui/form';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

export default function Public() {
  const [attachment, setAttachment] = useState<PublicAttachment | null>(null);
  const [code, setCode] = useState(''),
    [body, setBody] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(false);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const returningHome = useRef(false);
  useLayoutEffect(() => {
    if (body !== null) {
      resultHeadingRef.current?.focus();
    } else if (returningHome.current) {
      returningHome.current = false;
      codeInput.current?.focus();
    }
  }, [body]);
  useEffect(() => {
    if (copyError) {
      fallbackRef.current?.focus();
      fallbackRef.current?.select();
    }
  }, [copyError]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const accessCode = code.trim();
    if (!/^[A-Za-z0-9]{4}$/.test(accessCode)) {
      setError('请输入恰好四位字母或数字，注意大小写');
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ body: string; attachment?: PublicAttachment }>('/share/resolve', {
        code: accessCode,
      });
      setAttachment(r.attachment ?? null);
      setBody(r.body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (body === null) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  function returnHome() {
    returningHome.current = true;
    setBody(null);
    setAttachment(null);
    setCode('');
    setCopied(false);
    setCopyError(false);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
          <Brand />
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="主要导航">
            <RepositoryLink
              className={buttonVariants({
                variant: 'ghost',
                className: 'px-2 text-sm max-sm:[&_.link-label]:hidden',
              })}
            />
            <Button variant="ghost" className="px-2 text-sm" render={<a href="/manage" />}>
              管理后台 <ArrowUpRight aria-hidden="true" />
            </Button>
          </nav>
        </div>
      </header>
      {body === null ? (
        <main className="flex flex-1 flex-col items-center gap-6 px-4 pt-12 pb-10 sm:gap-8 sm:pt-20">
          <div className="space-y-3 text-center">
            <h1 className="text-balance font-semibold text-3xl tracking-tight sm:text-5xl">
              <span className="inline-block">让文字，</span>{' '}
              <span className="inline-block text-primary">轻松抵达。</span>
            </h1>
            <p className="text-balance text-sm text-muted-foreground sm:text-base">
              接收分享的文字或附件。
            </p>
          </div>
          <Card className="access-card w-full min-w-0 max-w-sm">
            <CardPanel className="p-4 sm:p-6">
              <Form className="flex w-full flex-col gap-4" onSubmit={submit} noValidate>
                <Field invalid={Boolean(error)}>
                  <FieldLabel className="w-full justify-between">
                    访问码{' '}
                    <span className="font-normal text-muted-foreground text-xs">区分大小写</span>
                  </FieldLabel>
                  <Input
                    ref={codeInput}
                    id="access-code"
                    name="code"
                    type="text"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setError('');
                    }}
                    className="font-mono tracking-widest sm:text-base [&_[data-slot=input]]:h-11"
                    placeholder="Ab12"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={100}
                  />
                  <FieldDescription>4 位英文字母或数字</FieldDescription>
                  {error && (
                    <FieldError match render={<Alert variant="error" />}>
                      <CircleAlert aria-hidden="true" />
                      <AlertDescription>{error}</AlertDescription>
                    </FieldError>
                  )}
                </Field>
                <Button
                  className="primary w-full"
                  type="submit"
                  size="xl"
                  loading={busy}
                  aria-busy={busy}
                >
                  查看内容 <ArrowRight aria-hidden="true" />
                </Button>
              </Form>
            </CardPanel>
          </Card>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6 sm:px-6 sm:py-12">
          <Button type="button" variant="ghost" onClick={returnHome}>
            <ArrowLeft aria-hidden="true" />
            返回首页
          </Button>
          <Card render={<section aria-labelledby="result-title" />}>
            <CardHeader className="px-4 max-[360px]:has-data-[slot=card-action]:grid-cols-1 sm:px-6">
              <CardTitle
                id="result-title"
                className="w-fit max-w-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                render={<h1 ref={resultHeadingRef} tabIndex={-1} />}
              >
                {body ? '文字已抵达' : '文件已抵达'}
              </CardTitle>
              <CardDescription>
                {body ? '保留原样，随时复制' : '下载附件到你的设备'}
              </CardDescription>
              {body && (
                <CardAction className="max-[360px]:col-start-1 max-[360px]:row-span-1 max-[360px]:row-start-3 max-[360px]:justify-self-start">
                  <Button type="button" onClick={copy}>
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copied ? '已复制' : '复制全文'}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            {body && (
              <CardPanel className="min-w-0 space-y-3 px-4 sm:px-6">
                <pre
                  className="plain-text max-h-[60dvh] overflow-auto rounded-lg bg-muted p-3 font-mono text-sm leading-relaxed whitespace-break-spaces sm:p-4 [overflow-wrap:anywhere]"
                  tabIndex={0}
                  aria-label="正文"
                >
                  {body}
                </pre>
                {copyError && (
                  <>
                    <Alert variant="info" role="status">
                      <CircleAlert aria-hidden="true" />
                      <AlertDescription>
                        自动复制未成功，已为你选中文字，请手动复制。
                      </AlertDescription>
                    </Alert>
                    <Textarea
                      ref={fallbackRef}
                      className="font-mono [&_[data-slot=textarea]]:max-h-64"
                      aria-label="手动复制正文"
                      readOnly
                      value={body}
                    />
                  </>
                )}
                <p className="text-muted-foreground text-xs">
                  纯文本 · {new TextEncoder().encode(body).length.toLocaleString()} 字节
                </p>
              </CardPanel>
            )}
            {attachment && (
              <CardFooter className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
                <div className="min-w-0 flex-auto">
                  <p className="font-medium text-sm [overflow-wrap:anywhere]">{attachment.name}</p>
                  <p className="text-muted-foreground text-xs">{fileSize(attachment.size)}</p>
                </div>
                <Button
                  variant={body ? 'outline' : 'default'}
                  render={<a href={attachment.downloadUrl} download />}
                >
                  <Download aria-hidden="true" />
                  下载附件
                </Button>
              </CardFooter>
            )}
          </Card>
        </main>
      )}
    </div>
  );
}
