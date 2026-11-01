// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from './SafeMarkdown';

describe('SafeMarkdown', () => {
  it('renders the supported Markdown blocks and inline styles', () => {
    const { container } = render(
      <SafeMarkdown
        source={
          '# Title\n\n## Section\n\n### Detail\n\n#### More\n\nA **bold** and *italic* `code`.\n\n- One\n- Two\n\n1. First\n2. Second\n\n> Quoted'
        }
        className="custom"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Title', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Section', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Detail', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'More', level: 4 })).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('em')).toHaveTextContent('italic');
    expect(container.querySelector('code')).toHaveTextContent('code');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('blockquote')).toHaveTextContent('Quoted');
    expect(container.firstElementChild).toHaveClass('custom');
  });

  it('skips raw script elements and executable markup', () => {
    const { container } = render(
      <SafeMarkdown source={'Before <script>alert(1)</script> after'} />,
    );
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/<script|onerror=|onclick=/i);
  });

  it('skips raw image elements and event handler attributes', () => {
    const { container } = render(<SafeMarkdown source={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/onerror\s*=/i);
  });

  it.each([
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](java&#x09;script:alert(1))',
    '[x](data:text/html;base64,AAAA)',
    '[x](vbscript:msgbox(1))',
  ])('neutralises an unsafe link: %s', (source) => {
    const { container } = render(<SafeMarkdown source={source} />);
    expect(container.querySelector('a[href]')).not.toBeInTheDocument();
  });

  it.each([
    ['https://example.org/page', true],
    ['http://example.org/page', true],
    ['mailto:hello@example.org', false],
    ['tel:+921234567890', false],
    ['/about', false],
    ['#team', false],
  ])('keeps an allowed link: %s', (href, external) => {
    const { container } = render(<SafeMarkdown source={`[Link](${href})`} />);
    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', href);
    if (external) {
      expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
      expect(link).toHaveAttribute('target', '_blank');
    } else {
      expect(link).not.toHaveAttribute('target');
    }
  });

  it('rejects protocol-relative links and Markdown images', () => {
    const { container } = render(
      <SafeMarkdown source={'[bad](//evil.example) ![alt](https://x/y.png)'} />,
    );
    expect(container.querySelector('a[href]')).not.toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('does not turn raw HTML anchors into links', () => {
    const { container } = render(
      <SafeMarkdown source={'<a href="javascript:alert(1)" onclick="x()">bad</a>'} />,
    );
    expect(container.querySelector('a')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/onclick\s*=/i);
  });

  it('preserves Urdu text inside an RTL container', () => {
    const { container } = render(
      <div dir="rtl" lang="ur">
        <SafeMarkdown source="یہ اردو متن ہے" />
      </div>,
    );
    const rtl = container.querySelector('[dir="rtl"]');
    expect(rtl).not.toBeNull();
    expect(rtl).toHaveAttribute('lang', 'ur');
    expect(container).toHaveTextContent('یہ اردو متن ہے');
  });
});
