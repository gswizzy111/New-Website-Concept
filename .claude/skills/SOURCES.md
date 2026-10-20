# Vendored skills

| Skill folder(s) | Source | Commit | License |
|---|---|---|---|
| `design-md` | [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | f696123 | MIT |
| `design-taste-frontend` | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill` | ce26fc2 | MIT |
| `impeccable` (+ `../agents/impeccable-*.md`) | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) `.claude/` | 0d6b47e | Apache-2.0 |
| `emil-design-eng`, `animate`, `improve-animations`, `review-animations`, `find-animation-opportunities`, `animation-vocabulary`, `apple-design`, `pick-ui-library`, `prototype`, `ask-sonner`, `mobile-native` | [emilkowalski/skills](https://github.com/emilkowalski/skills) `skills/` | d16ebe6 | MIT |
| `playwright-cli` | [microsoft/playwright](https://github.com/microsoft/playwright) `packages/playwright-core/src/tools/skills/playwright-cli` | b08119b | Apache-2.0 |

Notes:
- Impeccable's automatic design-check hooks (upstream `.claude/settings.json`) are
  intentionally not committed. Its launcher downloads a checksum-verified engine
  binary from the project's GitHub releases on first use. To enable the hooks on
  one machine only, run `/impeccable hooks on` (writes the gitignored
  `.claude/settings.local.json`).
- Not vendored from emilkowalski/skills: `animate-expo`, `write-swift` (native
  mobile / Swift, not relevant to this web project).
