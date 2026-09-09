/** Find only newly inserted text; deletions must not erase historical mistakes. */
export function getTextInsertion(
  before: string,
  after: string,
  selectionEnd: number,
  data: string | null,
): { start: number; text: string } {
  // InputEvent.data disambiguates repeated letters and identical replacements.
  if (data !== null) {
    const start = selectionEnd - data.length;
    const oldEnd = start + before.length - after.length + data.length;
    if (
      start >= 0 &&
      oldEnd >= start &&
      oldEnd <= before.length &&
      before.slice(0, start) + data + before.slice(oldEnd) === after
    ) {
      return { start, text: data };
    }
  }

  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start++;
  }
  let oldEnd = before.length;
  let newEnd = after.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  return { start, text: after.slice(start, newEnd) };
}
