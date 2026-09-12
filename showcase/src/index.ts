import { registerRoot } from "remotion";

import { RemotionRoot } from "./GretelShowcase";

// The composition uses "Space Mono" — Gretel's own typeface — so the showcase
// matches the product. The font is resolved by the rendering machine rather
// than fetched at render time: Remotion's `loadFont()` holds a delayRender()
// open until the FontFace resolves, which is fragile across the many browser
// pages a long concurrent render spins up. Install it once with:
//
//   mkdir -p ~/.fonts && cp public/fonts/*.woff2 ~/.fonts/ && fc-cache -f ~/.fonts
//
// (scripts/install-font.sh does this, and README.md documents it.)

registerRoot(RemotionRoot);
