// Markdown preprocessing adapted from DeerFlow (bytedance/deer-flow) frontend
// core/streamdown/preprocess.ts + core/messages/utils.ts, MIT License.
// Scoped to what applies to Milo's hand-written (iterative, React-element)
// Md renderer: leaked-internal-tag stripping + nesting caps as cheap insurance
// on untrusted member text (编制设计 §3.5 信任边界). The math/marked-recursion
// machinery upstream does NOT apply to our stack and is intentionally omitted.
// Copyright (c) 2025 Bytedance Ltd.; (c) 2025-2026 DeerFlow Authors. See /NOTICE.

// Backend-injected marker tags that can leak into member/secretary text
// (DeerFlow-derived harness). Rendered literally they are noise; strip the
// tags while preserving inner content — code-aware so meta-discussions survive.
const INTERNAL_MARKER_TAGS = [
  "uploaded_files",
  "slash_skill_activation",
  "system-reminder",
  "system_reminder",
  "memory",
  "current_date",
] as const;

const INTERNAL_TAG_RE = new RegExp(
  `</?(?:${INTERNAL_MARKER_TAGS.join("|")})(?:\\s[^>]*)?/?>`,
  "g",
);

const CODE_FENCE_RE = /^ {0,3}(?:```|~~~)/;
const INDENTED_CODE_RE = /^(?: {4}|\t)/;

// Only up to 3 leading spaces can start a blockquote; 4+ is indented code.
const BLOCKQUOTE_PREFIX_RE = /^ {0,3}(?:[ \t]*>)+/;
const MAX_BLOCKQUOTE_DEPTH = 100;
const DEEP_BLOCKQUOTE_HINT_RE = new RegExp(
  `^(?:[ \\t]*>){${MAX_BLOCKQUOTE_DEPTH + 1}}`,
  "m",
);
const MAX_LIST_INDENT = 200;
const DEEP_INDENT_HINT_RE = new RegExp(`^[ \\t]{${MAX_LIST_INDENT + 1},}`, "m");

/** Strip leaked system-internal HTML tags, keeping inner content; code-aware. */
export function stripLeakedSystemTags(markdown: string): string {
  if (!markdown.includes("<")) return markdown;
  let insideFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (CODE_FENCE_RE.test(line)) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence || INDENTED_CODE_RE.test(line)) return line;
      return line.replace(INTERNAL_TAG_RE, "");
    })
    .join("\n");
}

/** Cap runaway blockquote depth on untrusted text; code-aware. */
export function capBlockquoteNesting(markdown: string): string {
  if (!DEEP_BLOCKQUOTE_HINT_RE.test(markdown)) return markdown;
  let insideFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (CODE_FENCE_RE.test(line)) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence || INDENTED_CODE_RE.test(line)) return line;
      const match = BLOCKQUOTE_PREFIX_RE.exec(line);
      if (!match) return line;
      const prefix = match[0];
      let depth = 0;
      for (let i = 0; i < prefix.length; i++) {
        if (prefix[i] === ">") {
          depth += 1;
          if (depth > MAX_BLOCKQUOTE_DEPTH) {
            return line.slice(0, i) + line.slice(prefix.length);
          }
        }
      }
      return line;
    })
    .join("\n");
}

/** Cap runaway indentation on untrusted text; code-aware. */
export function capListNesting(markdown: string): string {
  if (!DEEP_INDENT_HINT_RE.test(markdown)) return markdown;
  let insideFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (CODE_FENCE_RE.test(line)) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence) return line;
      const whitespace = /^[ \t]*/.exec(line)![0];
      if (whitespace.length <= MAX_LIST_INDENT) return line;
      return " ".repeat(MAX_LIST_INDENT) + line.slice(whitespace.length);
    })
    .join("\n");
}

/** Full untrusted-text normalization applied before Md parsing. */
export function preprocessMemberMarkdown(markdown: string): string {
  return capListNesting(capBlockquoteNesting(stripLeakedSystemTags(markdown)));
}
