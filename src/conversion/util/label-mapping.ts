import type {
  SelfLabel,
  SelfLabels,
} from '@atproto/api/dist/client/types/com/atproto/label/defs'

const LABEL_TO_CW: Record<string, string> = {
  porn: 'Adult Content (Porn)',
  sexual: 'Sexual Content',
  nudity: 'Nudity',
  'graphic-media': 'Graphic Media (Violence/Gore)',
}

const CW_KEYWORDS_TO_LABEL = [
  { pattern: /\b(porn|pornograph)/i, label: 'porn' },
  { pattern: /\b(nsfw|adult\s*content|explicit)/i, label: 'sexual' },
  { pattern: /\b(nude|nudity)/i, label: 'nudity' },
  { pattern: /\b(gore|graphic|violence|blood)/i, label: 'graphic-media' },
]

/**
 * Convert Bluesky self-labels to Mastodon content warning.
 *
 * @param labels - The SelfLabels from a Bluesky post
 * @returns Content warning info or null if no relevant labels
 */
export function labelsToContentWarning(labels: SelfLabels | undefined) {
  if (!labels?.values || labels.values.length === 0) {
    return null
  }

  const cwTexts: string[] = []

  for (const label of labels.values) {
    // Skip authentication-related labels
    if (label.val === '!no-unauthenticated') {
      continue
    }

    const cwText = LABEL_TO_CW[label.val]
    if (cwText) {
      cwTexts.push(cwText)
    }
  }

  if (cwTexts.length === 0) {
    return null
  }

  return {
    summary: cwTexts.join(', '),
    sensitive: true,
  }
}

/**
 * Convert Mastodon content warning to Bluesky self-labels.
 *
 * @param summary - The CW text (may be null or empty)
 * @param sensitive - Whether the content is marked as sensitive
 * @returns SelfLabels or null if no labels should be applied
 */
export function contentWarningToLabels(
  summary: string | null | undefined,
  sensitive: boolean,
) {
  const labelVals = new Set<string>()

  if (summary) {
    for (const { pattern, label } of CW_KEYWORDS_TO_LABEL) {
      if (pattern.test(summary)) {
        labelVals.add(label)
      }
    }
  }

  // If sensitive=true but no keywords matched, default to 'sexual' (generic adult content)
  if (sensitive && labelVals.size === 0) {
    labelVals.add('sexual')
  }

  if (labelVals.size === 0) {
    return null
  }

  const values: SelfLabel[] = Array.from(labelVals).map((val) => ({
    $type: 'com.atproto.label.defs#selfLabel',
    val,
  }))

  return {
    $type: 'com.atproto.label.defs#selfLabels',
    values,
  }
}
