import React, { useEffect, useRef, useState } from 'react';
let dialogCount = 0;
let originalBodyOverflow = '';
export default function Dialog({
  children,
  close,
  label,
  drawer = false,
  className = '',
  exiting = false,
  onExited,
  descriptionId,
}: {
  children: React.ReactNode;
  close: () => void;
  label: string;
  drawer?: boolean;
  className?: string;
  exiting?: boolean;
  onExited?: () => void;
  descriptionId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [nested] = useState(() => dialogCount > 0);
  const exitCallback = useRef(onExited);
  exitCallback.current = onExited;
  useEffect(() => {
    const el = ref.current!,
      previousFocus = document.activeElement as HTMLElement | null;
    if (dialogCount === 0) originalBodyOverflow = document.body.style.overflow;
    dialogCount++;
    document.body.style.overflow = 'hidden';
    el.showModal();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    if (!drawer && !reduced.matches) {
      el.animate(
        [
          { opacity: 0, transform: 'translateY(8px) scale(0.99)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    }
    const stopMotion = () => {
      if (reduced.matches) el.getAnimations().forEach((a) => a.cancel());
    };
    reduced.addEventListener('change', stopMotion);
    el.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    return () => {
      reduced.removeEventListener('change', stopMotion);
      el.getAnimations().forEach((a) => a.cancel());
      el.close();
      dialogCount--;
      if (dialogCount === 0) document.body.style.overflow = originalBodyOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    if (!exiting) return;
    const el = ref.current!;
    let active = true;
    const current = getComputedStyle(el);
    const start = { opacity: current.opacity, transform: current.transform };
    el.getAnimations()
      .filter((a) => !(a instanceof CSSAnimation))
      .forEach((a) => a.cancel());
    const animation = matchMedia('(prefers-reduced-motion: reduce)').matches
      ? null
      : el.animate([start, { opacity: '0', transform: 'translateY(4px) scale(0.995)' }], {
          duration: 150,
          easing: 'ease-out',
          fill: 'forwards',
        });
    Promise.allSettled(animation ? [animation.finished] : []).then(() => {
      if (active) exitCallback.current?.();
    });
    return () => {
      active = false;
      animation?.cancel();
    };
  }, [exiting]);
  return (
    <dialog
      className={`${drawer ? 'drawer' : 'modal'} ${className}`.trim()}
      ref={ref}
      aria-label={label}
      aria-describedby={descriptionId}
      data-nested={nested || undefined}
      data-exiting={exiting || undefined}
      onCancel={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!exiting) close();
      }}
      onClick={(e) => {
        if (!exiting && e.target === e.currentTarget) close();
      }}
    >
      {children}
    </dialog>
  );
}
