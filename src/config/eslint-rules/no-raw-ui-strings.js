/**
 * ESLint rule: no-raw-ui-strings
 *
 * Warns when a string literal that looks like a user-facing message appears
 * directly in a JSX text node instead of being sourced from LABELS.
 *
 * Only applied to src/tui/ — the CLI uses console.log/failCommand which are
 * harder to distinguish from technical logging without full type info.
 *
 * False-positive escape hatch: add eslint-disable-next-line ccm/no-raw-ui-strings
 * for the rare case where a raw string is intentional (e.g. a single symbol).
 */

/** Patterns whose strings are considered non-UI (technical / structural). */
const TECHNICAL_RE = /^[/\\#`$%{(<]|^https?:\/\//
const MIN_LETTER_PAIR = /[a-zA-Z]{2}/

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require user-facing strings to come from LABELS (src/config/labels.ts) instead of raw literals.',
      url: 'https://github.com/your-org/ccm#i18n',
    },
    messages: {
      rawUiString: 'Raw UI string "{{text}}" — use LABELS.xxx from src/config/labels.ts instead.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXText(node) {
        const raw = node.value
        const text = raw.trim()
        // Skip empty, very short, whitespace-only, or punctuation-only nodes
        if (!text || text.length < 3) return
        // Must contain at least two consecutive letters to qualify as human text
        if (!MIN_LETTER_PAIR.test(text)) return
        // Skip strings that look like technical / structural content
        if (TECHNICAL_RE.test(text)) return

        context.report({
          node,
          messageId: 'rawUiString',
          data: { text: text.length > 50 ? text.slice(0, 47) + '…' : text },
        })
      },
    }
  },
}

export default rule
