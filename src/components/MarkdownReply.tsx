import 'highlight.js/styles/github.css';

import { ActionIcon, CopyButton, Tooltip, Typography } from '@mantine/core';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

/**
 * An LLM reply rendered as markdown with code highlighting. Raw HTML in the reply is never rendered as HTML
 * (without rehype-raw, react-markdown shows it as plain text), and its default urlTransform drops unsafe link URLs.
 */
export function MarkdownReply({ children }: { children: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <CopyButton value={children}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Copied' : 'Copy reply'}>
            <ActionIcon
              variant="subtle"
              color={copied ? 'teal' : 'gray'}
              onClick={copy}
              aria-label="Copy reply"
              style={{ position: 'absolute', top: 0, right: 0 }}
            >
              {copied ? '✓' : '⧉'}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
      <Typography pr={36}>
        <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{children}</ReactMarkdown>
      </Typography>
    </div>
  );
}
