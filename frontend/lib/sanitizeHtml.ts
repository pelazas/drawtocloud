import sanitizeHtmlLib from "sanitize-html";

export function sanitizeHtml(dirty: string): string {
  return sanitizeHtmlLib(dirty, {
    allowedTags: [
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
    allowedAttributes: {
      "*": ["class", "style", "data-language", "data-theme", "tabindex"],
      a: ["href", "title"],
    },
  });
}
