import type { ComponentProps } from "react";
import type { Element } from "hast";

/**
 * Shared Streamdown `components` overrides.
 *
 * Why: Streamdown's default `img` renderer wraps the image in a `<div>` (for
 * loading skeleton / sizing). Markdown like `![](url)` on its own line is
 * parsed as a paragraph containing a single image, which the default renderer
 * emits as `<p><div>...</div></p>` — invalid HTML, and React 18+ flags it as
 * a hydration error in dev mode.
 *
 * Fix: render markdown paragraphs as `<div>` whenever they contain a known
 * block-level child (img/video/iframe). Pure-text paragraphs still render as
 * `<p>` so semantic markup is preserved.
 */
const BLOCK_TAGS = new Set(["img", "video", "iframe", "picture", "figure"]);

type ParagraphProps = ComponentProps<"p"> & { node?: Element };

function SafeParagraph({ node, children, ...rest }: ParagraphProps) {
  const hasBlockChild = node?.children?.some(
    (c) => c.type === "element" && BLOCK_TAGS.has((c as Element).tagName)
  );
  if (hasBlockChild) {
    return <div {...rest}>{children}</div>;
  }
  return <p {...rest}>{children}</p>;
}

export const streamdownComponents = {
  p: SafeParagraph,
};
