// FINDING A PHRASE IN A PAGE OF A PDF.
//
// `/` in the reader runs this over the text pdf.js extracts from each page,
// and then runs it AGAIN over the DOM of the rendered text layer to turn the
// hit into a Range it can highlight. Both passes call the same function on the
// same normalization, which is the only reason the second pass finds the same
// k-th match as the first.
//
// The fold this rests on — harakat, the alef family, ى/ي, ة/ه, tatweel, the
// Latin combining block — was written HERE, for exactly the reason the reader
// needs it: a book is where pointed Arabic actually lives, and a reader who
// types «المقدمة» and is told "no matches" by a page printing «الْمُقَدِّمَة»
// concludes the search is broken, which it is.
//
// v1.8 moved the table one floor down to `shared/fold.ts`, because the vault's
// own search index needed the same answer (parity request #4) and two copies of
// a fold eventually disagree — at which point the note index and the reader
// that opens from it are searching different languages. The READER'S SCANNER
// did not move: it is still `findMatches`, still reporting offsets into the
// untouched string, because only offsets can be turned back into a DOM Range.
// This module stays the reader's door onto it so nothing in books/ has to know
// where the table sleeps.

export { findMatches, foldQuery, type Match } from "../../shared/fold.ts";
