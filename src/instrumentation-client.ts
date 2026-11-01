// Next.js client instrumentation: runs in the browser before hydration, so before any
// client component module (and the zod schemas it imports) is evaluated.
//
// The page CSP has no 'unsafe-eval' (docs/adr/0012-nonce-based-csp.md). Zod object
// schemas otherwise probe for eval with `new Function('')` when they are built; the probe
// is caught, but the browser still blocks it and reports a securitypolicyviolation on
// every page with a validated form. Jitless parsing gives the same results without eval.
import { config } from 'zod';

config({ jitless: true });
