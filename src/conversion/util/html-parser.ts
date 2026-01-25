import { LanguageString } from '@fedify/fedify'
import { convert, type DomNode } from 'html-to-text'

export interface ParsedContent {
  text: string
  langs: string[]
  links: CollectedLink[]
}

export interface CollectedLink {
  href: string
  textContent: string
  isMention: boolean
}

function getTextContent(nodes: DomNode[]): string {
  let text = ''
  for (const node of nodes) {
    if (node.type === 'text') {
      text += node.data || ''
    } else if (node.type === 'tag') {
      // Skip invisible elements (Mastodon uses .invisible class to hide parts of URLs)
      const classList = (node.attribs?.class || '').split(/\s+/)
      if (classList.includes('invisible')) {
        continue
      }
      if (node.children) {
        text += getTextContent(node.children)
      }
    }
  }
  return text
}

/**
 * Check if an anchor element is a mention link.
 * Mastodon uses class="mention" or "u-url mention" patterns.
 */
function isMentionLink(classList: string[]): boolean {
  return classList.includes('mention')
}

export function parseHtmlContent(
  html: string,
  language?: string,
): ParsedContent {
  const collectedLinks: CollectedLink[] = []

  const text = convert(html, {
    wordwrap: false,
    preserveNewlines: true,
    formatters: {
      anchorCollector: (elem, walk, builder, _formatOptions) => {
        const href = elem.attribs?.href
        if (!href) {
          walk(elem.children, builder)
          return
        }

        const classList = (elem.attribs?.class || '').split(/\s+/)
        const textContent = getTextContent(elem.children).trim()

        walk(elem.children, builder)

        if (textContent) {
          collectedLinks.push({
            href,
            textContent,
            isMention: isMentionLink(classList),
          })
        }
      },
    },
    selectors: [
      {
        selector: 'a',
        format: 'anchorCollector',
      },
      {
        selector: 'p',
        format: 'block',
        options: {
          leadingLineBreaks: 1,
          trailingLineBreaks: 1,
        },
      },
      {
        selector: 'br',
        format: 'lineBreak',
      },
      // Remove invisible elements (Mastodon uses these for URL display)
      {
        selector: '.invisible',
        format: 'skip',
      },
    ],
  })

  const trimmedText = text.trim()

  return {
    text: trimmedText,
    langs: language ? [language] : [],
    links: collectedLinks,
  }
}

export function extractLanguage(content: string | LanguageString): {
  text: string
  language?: string
} {
  if (typeof content === 'string') {
    return { text: content }
  }

  const text = content.toString()
  const language = content.language.toString()

  return { text, language }
}
