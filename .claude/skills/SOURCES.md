# Vendored skills

| Skill folder(s) | Source | Commit | License |
|---|---|---|---|
| `design-md` | [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | f696123 | MIT |
| `design-taste-frontend` | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill` | ce26fc2 | MIT |
| `impeccable` (+ `../agents/impeccable-*.md`) | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) `.claude/` | 0d6b47e | Apache-2.0 |
| `emil-design-eng`, `animate`, `improve-animations`, `review-animations`, `find-animation-opportunities`, `animation-vocabulary`, `apple-design`, `pick-ui-library`, `prototype`, `ask-sonner`, `mobile-native` | [emilkowalski/skills](https://github.com/emilkowalski/skills) `skills/` | d16ebe6 | MIT |
| `playwright-cli` | [microsoft/playwright](https://github.com/microsoft/playwright) `packages/playwright-core/src/tools/skills/playwright-cli` | b08119b | Apache-2.0 |
| `frontend-design`, `canvas-design`, `algorithmic-art`, `webapp-testing` | [anthropics/skills](https://github.com/anthropics/skills) `skills/` | 2c5958e | Apache-2.0 |
| `gsap-core`, `gsap-react`, `gsap-scrolltrigger`, `gsap-timeline`, `gsap-plugins`, `gsap-performance`, `gsap-utils` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) `skills/` | aed9cfd | MIT |
| `threejs-*` (13 skills, incl. `threejs-react-three-fiber`, `threejs-shaders`) | [CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills) `skills/` | 0e18186 | MIT |
| `shader-glsl`, `particle-system` | [iart-ai/webgl-animation-skills](https://github.com/iart-ai/webgl-animation-skills) `skills/` | 0041933 | MIT |
| `svg-creator` | [upbrew-tech/svg-creator-skill](https://github.com/upbrew-tech/svg-creator-skill) | 1eb83d6 | Apache-2.0 |
| `pixelfx` | [patch-gg/pixelfx](https://github.com/patch-gg/pixelfx) `skills/pixelfx` | 5294518 | MIT |
| `react-best-practices`, `react-view-transitions`, `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/` | 1a2c79d | MIT |
| `preview-site` | Written for this repo | — | — |

Notes:
- Impeccable's automatic design-check hooks (upstream `.claude/settings.json`) are
  intentionally not committed. Its launcher downloads a checksum-verified engine
  binary from the project's GitHub releases on first use. To enable the hooks on
  one machine only, run `/impeccable hooks on` (writes the gitignored
  `.claude/settings.local.json`).
- Not vendored from emilkowalski/skills: `animate-expo`, `write-swift` (native
  mobile / Swift, not relevant to this web project).
- Not vendored from greensock/gsap-skills: `gsap-frameworks` (Vue/Svelte only).
  From iart-ai/webgl-animation-skills: `threejs-animation` (name clashes with the
  CloudAI-X skill, which covers it).
- `pixelfx` works from a separate checkout of github.com/patch-gg/pixelfx (the
  skill clones it on first use). Its optional publishing step installs the
  `pch` CLI; only do that with the owner's OK.
- `svg-creator`'s `scripts/svg_loop.py` pip-installs `cairosvg` on first run to
  render previews.
