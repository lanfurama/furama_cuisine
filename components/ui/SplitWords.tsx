/*
 * A heading's words, each in a mask of its own, so they can rise one after
 * another (lib/motion.tsx: the `title` reveal, and the hero's `word` intro).
 * The spaces stay plain text between the masks, so the heading still reads as
 * one sentence to assistive technology and wraps where it did. A language
 * written without spaces is one "word": it rises whole.
 */
export function SplitWords({ text, intro, introStart = 0 }: { text: string; intro?: number; introStart?: number }) {
  let n = introStart;
  return (
    <>
      {text.split(/(\s+)/).map((part, i) =>
        part === '' ? null : /^\s+$/.test(part) ? (
          part
        ) : (
          <span key={i} className="sw">
            {intro === undefined ? (
              <span className="sw-in" data-word="">
                {part}
              </span>
            ) : (
              <span className="sw-in" data-intro={intro} data-intro-kind="word" data-intro-sub={n++}>
                {part}
              </span>
            )}
          </span>
        ),
      )}
    </>
  );
}
