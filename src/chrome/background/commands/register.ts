/**
 * Top-level synchronous wiring for the commands listener.
 *
 * Importing this module is the install step — it calls `registerCommands`
 * with the real `dispatchActivation` at module load. Kept separate from
 * `./index.ts` so the factory can be imported in tests without firing
 * the side-effect (and without doubling the addListener call count).
 *
 * MV3 invariant: this file MUST be imported synchronously from the SW
 * entry (`src/chrome/background/index.ts`) so the listener is
 * registered before any await on every SW wake.
 */

import { dispatchActivation } from '../activation/dispatch';
import { registerCommands } from './index';

registerCommands({ dispatch: dispatchActivation });
