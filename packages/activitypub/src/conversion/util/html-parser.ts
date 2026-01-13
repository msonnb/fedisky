import { LanguageString } from '@fedify/fedify'
import { convert, type DomNode } from 'html-to-text'
import { RichText, Facet } from '@atproto/api'

export interface ParsedContent {
  text: string
  langs: string[]
  facets: Facet[]
}

interface CollectedLink {
  href: string
  textContent: string
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

        const textContent = getTextContent(elem.children).trim()

        walk(elem.children, builder)

        if (textContent) {
          collectedLinks.push({
            href,
            textContent,
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

  const richText = new RichText({ text: trimmedText })
  const facets: Facet[] = []
  let searchFromIndex = 0

  for (const link of collectedLinks) {
    const foundIndex = trimmedText.indexOf(link.textContent, searchFromIndex)
    if (foundIndex !== -1) {
      const byteStart = richText.unicodeText.utf16IndexToUtf8Index(foundIndex)
      const byteEnd = richText.unicodeText.utf16IndexToUtf8Index(
        foundIndex + link.textContent.length,
      )

      facets.push({
        index: {
          byteStart,
          byteEnd,
        },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: link.href,
          },
        ],
      })

      searchFromIndex = foundIndex + link.textContent.length
    }
  }

  return {
    text: trimmedText,
    langs: language ? [language] : [],
    facets,
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
