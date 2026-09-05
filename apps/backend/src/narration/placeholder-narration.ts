/**
 * What the local-fake narration path writes, and the name its record carries.
 *
 * Four bytes of MP3 header and no audio, written when there is no TTS credential so the rest of the pipeline
 * can still be walked. Three services wrote out these same four bytes — the short generation, the short review,
 * and the Episode's — and the Episode's own comment said so, which is a copy that knows it is one.
 *
 * The clip and image placeholders each got a home like this after the number of places that knew what a
 * placeholder looks like turned out to be the number of places that could disagree about it. Narration was the
 * third of the three and the only one still scattered.
 *
 * 🔴 No `isPlaceholderNarration(bytes)` here, deliberately, and that is the difference from the other two. A
 * four-byte header is a valid MP3 of non-zero size, so the file cannot be asked — asking `size > 0` is exactly
 * what put a silent stub into finished videos as though it were a voice. `PLACEHOLDER_ADAPTER` on the record is
 * the only thing that knows, and every caller here reads it rather than the bytes.
 */
export const PLACEHOLDER_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

/** Named once, because the reuse decision and the record that drives it have to agree on it exactly. */
export const PLACEHOLDER_ADAPTER = "local-fake-tts-adapter";
