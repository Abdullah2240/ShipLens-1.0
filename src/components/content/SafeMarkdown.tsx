import ReactMarkdown from 'react-markdown';

const allowedElements = [
  'p',
  'br',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'a',
  'hr',
];

function safeUrlTransform(value: string): string {
  const url = value.trim().replace(/[\u0000-\u0020\u007f]/g, '');
  if (!url) return '';
  if (url.startsWith('#')) return url;
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return url;
  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(url)) return url;
  return '';
}

export function SafeMarkdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={`space-y-4 text-text ${className ?? ''}`}>
      <ReactMarkdown
        skipHtml
        allowedElements={allowedElements}
        unwrapDisallowed
        urlTransform={safeUrlTransform}
        components={{
          h1: ({ children }) => <h2 className="text-2xl font-semibold">{children}</h2>,
          h2: ({ children }) => <h2 className="text-2xl font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xl font-semibold">{children}</h3>,
          h4: ({ children }) => <h4 className="text-lg font-semibold">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc ps-6">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal ps-6">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-s-4 border-border-strong ps-4">{children}</blockquote>
          ),
          a: ({ href, children }) => {
            const external = /^https?:\/\//i.test(href ?? '');
            return (
              <a
                href={href || undefined}
                className="text-primary underline underline-offset-4"
                rel={external ? 'noopener noreferrer nofollow' : undefined}
                target={external ? '_blank' : undefined}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
