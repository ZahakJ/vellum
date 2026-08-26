// THE CLIENT'S SAFETY NET (v1.8 client-solidity audit, section B).
//
// Four failures shared one shape: the client noticed something had gone wrong
// and then said nothing, for ever. A save refused by a precondition it could
// not re-base; a `fetch` with no deadline; a 2xx that was somebody else's login
// page; a rejected promise with no handler above it. Each is a policy now, and
// a policy is a pure function with a test — the same argument revalidate.ts
// makes one file over.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { staleRetryStep } from "../client/editor/saveRetry.ts";
import { ApiError, getNote, requestSignal, timeoutError } from "../client/api.ts";
import { errorSentence } from "../client/safety.ts";
import { setLang } from "../client/i18n.ts";

/** Wait, honestly — these are millisecond deadlines and there is nothing to
 *  fake: `AbortSignal.timeout` runs on a timer no mock reaches. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("the stale-save backoff", () => {
  it("speaks on the FIRST failure — the whole point of the fix", () => {
    // Before v1.8 this state announced nothing at all, ever: the save loop
    // 409'd, the re-read failed, the branch returned, and a reader kept typing
    // into a buffer that would never reach disk.
    const first = staleRetryStep(0);
    assert.equal(first.announce, true);
    assert.equal(first.waitMs, 1_000);
  });

  it("backs off, and goes quiet between the two things worth saying", () => {
    const waits = [0, 1, 2, 3, 4].map((n) => staleRetryStep(n).waitMs);
    assert.deepEqual(waits, [1_000, 2_000, 4_000, 8_000, 15_000]);
    assert.equal(staleRetryStep(1).announce, false);
    assert.equal(staleRetryStep(2).announce, false);
  });

  it("says it again once the backoff has reached its ceiling", () => {
    // By 15s this has stopped being a blip and the first toast is long gone.
    assert.equal(staleRetryStep(4).announce, true);
  });

  it("never gives up, and never becomes a heartbeat", () => {
    // The buffer holds the reader's only copy: a client that stops trying has
    // decided on their behalf that the server is not coming back.
    for (const attempt of [5, 20, 500]) {
      assert.equal(staleRetryStep(attempt).waitMs, 15_000);
    }
    const announced = [];
    for (let n = 4; n < 40; n++) if (staleRetryStep(n).announce) announced.push(n);
    assert.deepEqual(announced, [4, 12, 20, 28, 36]); // ~every two minutes
  });

  it("is total — a negative attempt is still an answer, not a crash", () => {
    assert.equal(staleRetryStep(-1).waitMs, 1_000);
  });
});

describe("the request deadline", () => {
  it("aborts a request nobody answered", async () => {
    const signal = requestSignal(null, 10);
    assert.equal(signal.aborted, false);
    await sleep(40);
    assert.equal(signal.aborted, true);
    assert.equal((signal.reason as Error).name, "TimeoutError");
  });

  it("does not clobber the caller's own signal", async () => {
    // Search aborts its in-flight request on every keystroke. A deadline that
    // REPLACED init.signal would have made that a request per character with
    // nothing able to cancel it.
    const caller = new AbortController();
    const signal = requestSignal(caller.signal, 60_000);
    caller.abort();
    assert.equal(signal.aborted, true);
  });

  it("leaves a healthy request alone until its time is up", async () => {
    const caller = new AbortController();
    const signal = requestSignal(caller.signal, 5_000);
    await sleep(30);
    assert.equal(signal.aborted, false);
  });

  it("becomes an ApiError, not a bare DOMException", () => {
    const err = timeoutError(30_000);
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, "timeout");
    assert.equal(err.status, 0); // no server answered
  });
});

describe("a 2xx that is not this API", () => {
  it("throws instead of handing every caller a null typed as data", async () => {
    // The shape: an auth proxy in front of Vellum answers the expired XHR with
    // its own 200 HTML login page. `return body as T` used to make that an
    // empty vault, or a crash three frames later inside a component that had
    // every right to assume its data existed.
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("<!doctype html><title>Sign in</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    try {
      await assert.rejects(
        () => getNote("Welcome.md"),
        (err: unknown) => err instanceof ApiError && err.code === "notJson" && err.status === 200,
      );
    } finally {
      globalThis.fetch = real;
    }
  });

  it("still passes a real JSON answer through untouched", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ path: "Welcome.md", content: "hi", mtimeMs: 7 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      const note = await getNote("Welcome.md");
      assert.equal(note.content, "hi");
      assert.equal(note.mtimeMs, 7);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("what the net says", () => {
  it("names the two failures a reader can act on, in their own language", () => {
    setLang("en");
    assert.equal(errorSentence(timeoutError(30_000)), "The server did not answer in time");
    setLang("ar");
    assert.equal(errorSentence(timeoutError(30_000)), "لم يستجب الخادم في الوقت المتاح");
    // `ApiError.message` is the server's ENGLISH prose; an Arabic-only
    // operator reading it inside a fully Arabic panel is the failure
    // `ApiError.code` exists to end.
    assert.notEqual(errorSentence(timeoutError(30_000)), timeoutError(30_000).message);
    setLang("en");
  });

  it("falls back to one honest sentence for everything it has not understood", () => {
    setLang("en");
    assert.equal(
      errorSentence(new TypeError("x is not a function")),
      "Something went wrong — the details are in the browser console",
    );
    assert.equal(
      errorSentence(new ApiError("nope", 500, "somethingNewNextYear")),
      "Something went wrong — the details are in the browser console",
    );
  });
});
