# Self-identified weaknesses — issue #96 (rsvp-engine progress + time API)

Honest critique of my own design choices, surfaced BEFORE implementation so reviewers can press on them.

## 1. Live-getter shape couples engine state to the read API

I chose live getters on the engine object — `progress()`, `timeElapsed()`, `timeRemaining()` as methods that close over the engine's mutable `nextIndex` and `wpm` — to match the existing `state` getter idiom and the issue's preferred shape.

Trade-off: pure functions of the form `progress(snapshot)`, `timeElapsed(snapshot, wpm)` would be more testable in isolation, cheaper to reason about, and would let callers freeze a snapshot (e.g., for an animation frame) without re-querying the engine. The live-getter shape forces every read to go through the engine and makes the engine the single source of truth for "what time is it now," which is exactly the coupling pure functions would avoid.

Why I shipped live getters anyway: (a) consistent with the existing `state` getter, (b) the issue lists this as the preferred shape, (c) Safari ships it that way and parity-port is the MVP bar, (d) callers without the engine reference have no business asking for its progress.

If the controls surface (#47) ends up needing to snapshot progress at frame boundaries without engine references, this choice becomes a real cost.

## 2. `timeElapsed`/`timeRemaining` post-`stop()` is a math choice without explicit spec

Once the engine reaches `done` via natural completion, `nextIndex === words.length`, so `timeRemaining()` returns `0` (correct) and `timeElapsed()` returns `total * msPerWord` (the full duration). But `stop()` can leave `nextIndex` mid-stream — in that case `timeRemaining()` returns the milliseconds for the unread tail even though those words will never be emitted.

The issue spec says "milliseconds equivalent to `(total - index) * msPerWord`" — purely mechanical, no special-case for `stop`. I followed that literally. A reasonable alternative would be: in `DONE` state, force `timeRemaining()` to 0 regardless of where `nextIndex` was. I did NOT do that, because it would diverge from the spec's mechanical formula and would require deciding what `timeElapsed()` returns post-stop (full duration? clipped to actual playback time?). Punting that policy to a future call-site or follow-up issue.

## 3. Ratio precision and divergence from Safari literal API

`ratio = index / total` is a straight float divide. For realistic article sizes (≤ ~10k words) this is precise to many decimals. For pathological inputs the clamp guarantees `0 ≤ ratio ≤ 1`, but a consumer expecting `ratio` to be a strictly increasing sequence between subsequent word events could be surprised by floating-point step sizes when the article length doesn't divide cleanly. No real-world impact at expected scale; documenting it because the issue spec didn't constrain precision.

Additionally I chose to diverge from the Safari API: Safari exposes `progress().percent` (0-100 integer) and `timeElapsed()/timeRemaining()` returning **seconds** ceiling-rounded. The task spec for this issue requires `ratio` (0-1 float) and **milliseconds**. I followed the task spec, not Safari literally — call this out so a reviewer doesn't flag the divergence as a porting bug.
