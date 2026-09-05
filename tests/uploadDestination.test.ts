// A BOOK DROPPED ON A FOLDER IS FILED THERE; an image keeps the attachment
// setting. The owner dragged a PDF onto Library/ and found it in attachments/,
// because the default location mode ("specified") is built to ignore the drop
// target — which is right for an image that belongs to a note and wrong for a
// document being filed. `uploadDestination` is that distinction as a function.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uploadDestination, type AttachmentLocation } from "../shared/attachments.ts";

const specified: AttachmentLocation = { mode: "specified", folder: "attachments" };
const root: AttachmentLocation = { mode: "vault-root", folder: "" };
const sub: AttachmentLocation = { mode: "subfolder", folder: "_att" };

describe("uploadDestination", () => {
  it("files a dropped book in the folder it was dropped on, whatever the setting says", () => {
    for (const loc of [specified, root, sub]) {
      assert.equal(uploadDestination(loc, "Library", "pdf", true), "Library");
      assert.equal(uploadDestination(loc, "Books/Islamic", "pdf", true), "Books/Islamic");
    }
  });

  it("a book dropped on the tree's root is filed at the root", () => {
    assert.equal(uploadDestination(specified, "", "pdf", true), "");
  });

  it("an image keeps the attachment setting even when dropped on a folder", () => {
    assert.equal(uploadDestination(specified, "Library", "png", true), "attachments");
    assert.equal(uploadDestination(root, "Library", "jpg", true), "");
    assert.equal(uploadDestination(sub, "Library", "webp", true), "Library/_att");
  });

  it("a book PASTED into a note (not filed) is still an attachment", () => {
    assert.equal(uploadDestination(specified, "Library", "pdf", false), "attachments");
  });

  it("the type is the server's, so a renamed image cannot ride in as a book", () => {
    // The server sniffs bytes; `ext` here is what it found, never the name.
    assert.equal(uploadDestination(specified, "Library", "png", true), "attachments");
  });
});
