import {
  parseHtmlContent,
  extractLanguage,
} from '../src/conversion/util/html-parser'
import { LanguageString } from '@fedify/fedify'

describe('html-parser', () => {
  describe('parseHtmlContent', () => {
    it('should convert simple HTML to plain text', () => {
      const result = parseHtmlContent('<p>Hello world</p>')
      expect(result.text).toBe('Hello world')
    })

    it('should preserve paragraph breaks', () => {
      const result = parseHtmlContent(
        '<p>First paragraph</p><p>Second paragraph</p>',
      )
      expect(result.text).toContain('First paragraph')
      expect(result.text).toContain('Second paragraph')
    })

    it('should strip links but keep text', () => {
      const result = parseHtmlContent(
        '<p>Check out <a href="https://example.com">this link</a></p>',
      )
      expect(result.text).toBe('Check out this link')
      expect(result.text).not.toContain('https://example.com')
    })

    it('should handle empty content', () => {
      const result = parseHtmlContent('')
      expect(result.text).toBe('')
    })

    it('should include language if provided', () => {
      const result = parseHtmlContent('<p>Bonjour</p>', 'fr')
      expect(result.langs).toEqual(['fr'])
    })
  })

  describe('extractLanguage', () => {
    it('should handle plain string content', () => {
      const result = extractLanguage('Hello world')
      expect(result.text).toBe('Hello world')
      expect(result.language).toBeUndefined()
    })

    it('should extract language from LanguageString', () => {
      const langString = new LanguageString('Bonjour', 'fr')
      const result = extractLanguage(langString)
      expect(result.text).toBe('Bonjour')
      expect(result.language).toBe('fr')
    })
  })
})
