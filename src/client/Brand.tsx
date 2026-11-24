import { ArrowUpRight, Github } from 'lucide-react';

export function Brand() {
  return (
    <a
      className="inline-flex shrink-0 items-center gap-2.5 rounded-md font-semibold text-xl tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      href="/"
    >
      <span
        className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"
        aria-hidden="true"
      >
        <ArrowUpRight size={23} strokeWidth={2.8} />
      </span>
      <span>
        TextRelay<span className="text-primary">.</span>
      </span>
    </a>
  );
}
export function RepositoryLink({ className }: { className?: string }) {
  return (
    <a
      className={className}
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
