# Your widgets

Put each widget in its own folder here: `widgets/<name>/index.ts`, plus `smoke.ts` for its UI test. Start from [docs/first-widget.md](../docs/first-widget.md), or copy `examples/address-picker/`.

This folder is gitignored (except this file). The harness repo stays clean, and `git pull` updates the harness without touching your widgets.

Version control for your widgets is up to you. One light suggestion: this folder can be its own git repo (`git init` here, or clone your widgets repo into it), and the harness repo will leave it alone. If you'd rather commit widgets alongside the harness in a fork, remove the `widgets/*` lines from `.gitignore`.
