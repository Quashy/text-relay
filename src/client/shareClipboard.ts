export function shareMessage(
  share: { title: string; code: string },
  origin = location.origin,
): string {
  return `标题：${share.title}\n地址：${new URL('/', origin).href}\n访问码：${share.code}`;
}

export async function copyShareText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function copyCreatedShare(
  share: Promise<{ title: string; code: string }>,
): Promise<boolean> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      // Start during the save gesture; WebKit can await the actual server-generated code.
      const value = share.then((share) => new Blob([shareMessage(share)], { type: 'text/plain' }));
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
    (share) => copyShareText(shareMessage(share)),
    () => false,
  );
}
