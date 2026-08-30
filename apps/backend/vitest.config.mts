import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    /**
     * Not the 5s default, because this suite's tests are deliberately slow.
     *
     * They drive real files rather than stubbing the disk (D-017), so the heavy ones — a Nest app booted over
     * HTTP, an Episode carried through images and clips, an Asset index written from two processes — legitimately
     * take one to three and a half seconds on an idle Windows machine. That is inside the 5s ceiling with about
     * a 1.4x margin, which is no margin at all: running the frontend suite at the same time reproducibly turned
     * two to four of them red, every failure landing at 5.0-5.3s, with a different set of names each run.
     *
     * Names that move between runs are the signature of a machine that was busy, not of a defect, and a suite
     * that goes red because something else was running teaches people to re-run instead of read — which is how a
     * real failure gets waved through. 20s is not a new number here: it is what the four tests that already
     * outgrew the default each picked inline, so this is that decision applied where it was equally true and
     * nobody had been bitten yet.
     */
    testTimeout: 20_000,
  },
});
