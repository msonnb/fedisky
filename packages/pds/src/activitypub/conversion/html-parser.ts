import { LanguageString } from '@fedify/fedify'
import { convert } from 'html-to-text'

export interface ParsedContent {
  text: string
  langs: string[]
}

/**
 * Parse HTML content from ActivityPub Note and convert to plain text.
 */
export function parseHtmlContent(
  html: string,
  language?: string,
): ParsedContent {
  const text = convert(html, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      {
        selector: 'a',
        format: 'inline',
        options: {
          linkBrackets: false,
          ignoreHref: true,
        },
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
        format: 'inline',
        options: {},
      },
      // Remove invisible elements (Mastodon uses these for URL display)
      {
        selector: '.invisible',
        format: 'skip',
      },
    ],
  })

  return {
    text: text.trim(),
    langs: language ? [language] : [],
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
