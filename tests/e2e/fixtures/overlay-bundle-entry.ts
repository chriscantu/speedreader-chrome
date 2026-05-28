import * as overlay from '../../../src/core/overlay';
import * as rsvp from '../../../src/core/rsvp-engine';

(window as unknown as { __speedreader_overlay__: typeof overlay }).__speedreader_overlay__ = overlay;
(window as unknown as { __speedreader_rsvp__: typeof rsvp }).__speedreader_rsvp__ = rsvp;
