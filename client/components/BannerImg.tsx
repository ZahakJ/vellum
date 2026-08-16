// The React half of banner resolution (client/banner.ts owns the ladder and
// the cache). Every React surface that paints a value an author TYPED — a
// note's `banner:`, the site logo, the dashboard hero — reads it through here,
// so all of them accept the same four forms and none of them has to know that
// a bare filename needs a round trip to answer.
//
// Surfaces painting a value the SERVER already resolved (PostMeta.banner) do
// not need this: bannerSrc() is enough there, and asking again would be a
// request per card.

import { useEffect, useState } from "react";
import { bannerSrc, resolveBanner } from "../banner.ts";

/** The three states a typed image reference can be in. `pending` matters:
 *  "we do not know yet" must not render as "missing", or a hero flashes a
 *  broken-image card on every open before the answer lands. */
export interface BannerState {
  src: string | null;
  pending: boolean;
  missing: boolean;
}

/** Resolve `value` (null/empty → nothing) against `notePath`'s folder, then
 *  the vault, and hand back an <img src> — or the fact that it names nothing. */
export function useBannerSrc(
  value: string | null | undefined,
  notePath: string | null = null,
): BannerState {
  const clean = value?.trim() ?? "";
  const [state, setState] = useState<BannerState>(() => initial(clean, notePath));

  useEffect(() => {
    if (clean === "") {
      setState({ src: null, pending: false, missing: false });
      return;
    }
    const hit = resolveBanner(clean, notePath);
    if (typeof hit === "string" || hit === null) {
      setState(settled(hit));
      return;
    }
    // In flight: land the answer only if this component still wants it.
    let disposed = false;
    setState({ src: null, pending: true, missing: false });
    void hit.then((path) => {
      if (!disposed) setState(settled(path));
    });
    return () => {
      disposed = true;
    };
  }, [clean, notePath]);

  return state;
}

/** A cached answer is available on the FIRST render — no pending flash for a
 *  value the session has already resolved once. */
function initial(clean: string, notePath: string | null): BannerState {
  if (clean === "") return { src: null, pending: false, missing: false };
  const hit = resolveBanner(clean, notePath);
  if (typeof hit === "string" || hit === null) return settled(hit);
  return { src: null, pending: true, missing: false };
}

function settled(path: string | null): BannerState {
  return path === null
    ? { src: null, pending: false, missing: true }
    : { src: bannerSrc(path), pending: false, missing: false };
}
