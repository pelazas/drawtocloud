import DOMPurify from "isomorphic-dompurify";

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: [
      "pre",
      "code",
      "span",
      "div",
      "p",
      "br",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "a",
    ],
    ALLOWED_ATTR: [
      "class",
      "style",
      "data-language",
      "data-theme",
      "tabindex",
      "href",
      "title",
    ],
  });
}
