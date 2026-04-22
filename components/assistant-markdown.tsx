'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { sanitizeAssistantDisplayText } from '@/lib/sanitize-assistant-text';

const components: Components = {
  table: ({ children, ...props }) => (
    <div className="my-3 w-full overflow-x-auto rounded-md border border-border bg-background/50">
      <table
        className="w-full min-w-[min(100%,480px)] border-collapse text-left text-sm"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="border-b border-border bg-muted/90" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className="divide-y divide-border" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className="border-b border-border last:border-b-0" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => (
    <th
      className="whitespace-nowrap px-3 py-2 align-top text-xs font-semibold uppercase tracking-wide text-foreground"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="whitespace-pre-wrap px-3 py-2 align-top text-sm leading-snug" {...props}>
      {children}
    </td>
  ),
  p: ({ children, ...props }) => (
    <p className="mb-2 whitespace-pre-wrap last:mb-0" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="whitespace-pre-wrap leading-relaxed" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-foreground" {...props}>
      {children}
    </strong>
  ),
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      className="font-medium text-primary underline underline-offset-2 hover:opacity-90"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = /language-/.test(String(className ?? ''));
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-background px-1 py-0.5 font-mono text-xs text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }) => (
    <pre
      className="my-2 overflow-x-auto rounded-md border border-border bg-background/80 p-3 text-xs"
      {...props}
    >
      {children}
    </pre>
  ),
  hr: ({ ...props }) => (
    <hr className="my-3 border-border" {...props} />
  ),
};

export function AssistantMarkdown({ content }: { content: string }) {
  const safe = sanitizeAssistantDisplayText(content);
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground [&_p]:text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {safe}
      </ReactMarkdown>
    </div>
  );
}
