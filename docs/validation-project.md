# Validation project: postcode lookup widget

We want to know whether the docs and tooling here are enough for someone new to build a checkout widget. Your experience is the result. The widget itself is secondary.

## The brief

Build `postcode-lookup`: a small input above the shipping address form.

1. The shopper types an Australian postcode.
2. The widget shows the matching suburbs. A tiny hard-coded list is fine, e.g. 2000 → Sydney, Barangaroo, Haymarket, The Rocks.
3. The shopper picks one, and checkout's **city, state and postcode** fill in. Checkout should then save the address and show shipping quotes, just as if the shopper had typed them.
4. Other fields the shopper already typed (name, street) must be kept. What should happen when a signed-in shopper has a saved address selected? That's your call; tell us what you chose.

Done when:

- `npm run smoke -- postcode-lookup` passes, with a `widgets/postcode-lookup/smoke.ts` that drives your widget.
- It works for a guest, and for a signed-in shopper (`npm run dev -- postcode-lookup --login=1`).
- It still works after going to billing and clicking Edit on shipping.
- It's deployed with `npm run deploy -- postcode-lookup`, and `--deployed` smoke passes.

Start with `README.md` → `docs/first-widget.md`. Use an AI agent or not, as you prefer, but tell us which.

Stopping partway is a valid result, if you tell us where and why.

## Feedback (copy this into your reply)

```
Setup
- Time from clone to first `npm run dev` working:
- Anything missing or confusing in setup:

Building
- Did you use an AI agent? Which, and how much of the work did it do?
- Total time:
- Where did you get stuck? (Be specific: the file, the step, what you expected.)
- Did you have to read checkout-js source or docs/checkout-internals.md? For what?
- Did you touch src/harness/? What, and why?
- Anything you wanted from ctx.checkout that wasn't there?
- Saved-address choice: what did you do, and why?

Done criteria (for each: checked how? smoke, by hand, or not checked)
- smoke passes, including your widget's smoke.ts:
- guest:
- signed-in shopper:
- after billing → Edit shipping:
- deployed, and --deployed smoke passes:

Tooling
- dev loop (1–5, and why):
- smoke check (1–5, and why):
- deploy (1–5, and why):
- TypeScript: help or friction?

Overall
- Would you trust this approach in production for a merchant? What would make you trust it more?
- The one thing we should fix first:
```
