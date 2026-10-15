/**
 * banorte-bridge.js — hand Banorte's lightbox object to the app.
 *
 * Banorte's checkoutV2.js declares `let Payment = new function () {...}` at the
 * top level of a classic script. That creates a global *lexical* binding, which
 * other classic scripts can read but which is NOT a property of `window`, so
 * the React bundle (an ES module) cannot see it. This file is loaded right
 * after checkoutV2.js (see src/lib/banorteCheckout.ts) and copies the binding
 * onto window.
 *
 * Its own file because the public CSP is `script-src 'self'`: no inline
 * scripts, no eval.
 */
window.__banortePayment = typeof Payment !== 'undefined' ? Payment : undefined;
