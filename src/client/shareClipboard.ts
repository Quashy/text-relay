export function shareMessage(code: string, origin = location.origin): string {
  return `地址：${new URL('/', origin).href}\n访问码：${code}`;
}

export async function copyShareText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function copyCreatedShare(share: Promise<{ code: string }>): Promise<boolean> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      // Start during the save gesture; WebKit can await the actual server-generated code.
      const value = share.then(
        ({ code }) => new Blob([shareMessage(code)], { type: 'text/plain' }),
      );
      // A permission rejection can precede the API result. Both rejections must be handled.
      void value.catch(() => {});
      return navigator.clipboard.write([new ClipboardItem({ 'text/plain': value })]).then(
        () => true,
        () => false,
      );
    }
  } catch {
    // Older implementations can reject a promised ClipboardItem synchronously.
  }
  return share.then(
    ({ code }) => copyShareText(shareMessage(code)),
    () => false,
  );
}
