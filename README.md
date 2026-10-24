<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
    <img src="docs/assets/lh_banner_light.png" alt="LearnHarness" width="640">
  </picture>
</p>

<p align="center"><strong>An agent harness for learning.</strong></p>

<p align="center">
  <a href="https://learnharness.ai">Download</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/development.md">Documentation</a> ·
  <a href="https://github.com/amosblomqvist/learnharness/issues">Issues</a>
</p>

LearnHarness uses AI agents to plan and teach lessons from your current understanding to your goal. It builds a detailed picture of what you understand and how you reason. That picture is updated as you learn.

Instead of just giving you an explanation, it uses your answers and thinking to decide what you need next. Teaching builds understanding one reasoning step at a time. Practice makes it usable. A persistent knowledge graph carries it across sessions.

![LearnHarness teaching session](docs/assets/teaching-session.png)

## How it works

1. **Measure.** Before teaching, the agent finds where your understanding ends on each part the lesson depends on. Your answers, confidence, and thinking show it where to start.
2. **Plan.** It works out a dependency map from that starting point to your goal. You can see the plan, and the lesson adapts when your understanding turns out different.
3. **Teach.** Each step builds on something you already understand. You predict, get an explanation, and check your understanding. Confusions are repaired before anything is built on them. The aim is for the goal to feel obviously true, not merely familiar.
4. **Practice.** Separate sessions pose varied problems that require the right knowledge to come to mind without being named first. Problems and hints adapt to your reasoning.

**Think out loud.** The thinking fields let you explain your reasoning, uncertainties, and reactions in your own words. This is how the agent gets a detailed picture rather than just a record of right and wrong answers. You can type or use dictation.

The agent can also research questions in the background, create visual explanations, and build interactive demonstrations.

## Knowledge that carries forward

What you are taught accumulates as propositions and reasoning chains: individual claims and the premises that lead to them. The graph shows this structure, with links back to the source sessions. You can also import notes.

Future teaching sessions can read the graph instead of starting from scratch. Practice sessions can draw their material from it. It stores the ideas and their connections, not ratings of your ability.

![LearnHarness knowledge graph](docs/assets/knowledge-graph.png)

## Download and get started

**[Download from learnharness.ai](https://learnharness.ai)** · [GitHub Releases](https://github.com/amosblomqvist/learnharness/releases)

- **macOS (Apple Silicon):** signed and notarized DMG. Drag the app to Applications.
- **Windows (x64):** run the installer. It is currently unsigned; Windows may show an “unknown publisher” or SmartScreen warning.
- **Linux (x64):** make the AppImage executable and open it, or install the Debian/Ubuntu `.deb`.

Connect your ChatGPT subscription or add a provider API key and choose your models, then start a session with what you want to understand. LearnHarness supports 30+ provider options, including OpenAI, Anthropic, Google, DeepSeek, and OpenRouter. Dictation runs locally; optional web search uses a separate service key.

### Use your ChatGPT subscription (this fork)

1. Run `npm install` and `npm run dev`, then open http://localhost:3000.
2. In setup or **Settings → Keys**, click **Sign in with ChatGPT**, then **Continue sign-in in your browser**. Authorize ChatGPT plan usage with your eligible account.
3. Choose models from **openai-chatgpt** for Strong, Cheap and Vision, then save. Background agents use these slots too; replace any existing API-provider overrides if you want all model requests to use your plan.

This uses OpenAI's Sign in with ChatGPT plan-sharing flow. Plan eligibility, available models and usage limits apply. The picker is a model catalog; the first request confirms account access. Subscription requests never fall back to an API key, and usage is labeled **ChatGPT plan** rather than API dollars. Optional search still needs its own service key.

Credentials refresh automatically and live in `chatgpt-auth.json` beside the app's existing `auth.json` (desktop: its user data directory; development: the repository root). Both Git and the build exclude this file. **Disconnect** removes local tokens; manage app access and plan usage in ChatGPT settings. Sign-in uses loopback port 1455 on this computer; close any other pending Codex login if that port is busy. If the browser callback fails, expand **Browser did not return?** and paste the final redirect URL. Sign-in expires after 5 minutes.

All three platforms support in-app updates.

### Lamakū study priorities and homework preparation

Open **Study priorities & homework** on the home screen. **Connect Lamakū** opens a dedicated Chrome profile: sign in there with your UH account and complete Duo, then return to LearnHarness and click **Sync Lamakū**. Select courses and sync again. The browser session stays in the app's local data directory, separate from your everyday Chrome profile; passwords are entered only on UH's website. This connection reads visible course pages using your student session, rather than the registered OAuth API.

The study list prioritizes overdue work, work due within seven days, and uploaded homework. Submission status is shown as unknown when the page does not state it. Course pages and PDFs provide syllabus and assignment context; material hidden from your student account cannot be read. An expired session or failed sync is shown explicitly, and cached material remains available for manual lessons. Browser-based sync depends on Brightspace's page structure and must be checked against the selected courses.

Upload a PDF, PNG/JPEG/WebP photo, or TXT/Markdown homework file (up to 20 MB) to start preparation with your configured model. The tutor diagnoses prerequisite gaps, teaches using similar examples, and checks understanding before you attempt the homework. Scanned documents use your Vision model. References are stored separately from the knowledge graph and do not count as demonstrated understanding. Use **I’m ready to attempt this** to remove prepared work from the priority queue, or **Review again** to bring it back.

Automatic teaching can be disabled in the study panel. When enabled, opening LearnHarness syncs selected courses and starts or resumes one priority lesson per browser window. Existing homework lessons are reused. A sync failure pauses automatic teaching so stale deadlines are not silently presented as current.

### Local live dictation

Run `python scripts/setup_local.py` once. This installs faster-whisper and, on Windows, its GPU runtime into `.venv`; it reuses existing transcription weights. Faster-whisper also includes a small Silero VAD model. The worker reads existing `faster-distil-whisper-large-v3` or `faster-whisper-medium.en` paths from `~/Desktop/model_paths.md`. Alternatively, set `LH_WHISPER_MODEL` to an existing CTranslate2 model directory. Set `LH_WHISPER_PYTHON` if using a different Python environment or a packaged desktop build.

The existing mic button and shortcuts now show a live local transcript, refreshed about every 1.5 seconds. Stop commits the final text to the active answer field or composer; Escape discards it. Audio stays on this computer and needs no Deepgram key. The model stays warm between requests and uses CUDA when available, with CPU fallback. `GET /api/stt/token` reports the local engine and device; the legacy URL no longer mints a cloud token.

## Your keys, your data

- **Your keys and models.** No LearnHarness subscription or markup. You pay your providers for usage; a live cost meter shows model costs.
- **Local storage.** Your chats, graph, settings, and API keys live on your machine. Learning records are plain files you can inspect.
- **External services.** Models run through your configured providers. Model requests send the context needed for the task; web research and dictation also contact external services. Local storage does not mean offline processing.
- **Inspectable behavior.** System prompts are visible and editable. The app is open source under the AGPL-3.0 license.

## Development and support

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # deterministic, no LLM, no network
```

See the [development guide](docs/development.md), [architecture](docs/architecture.md), and [desktop release guide](docs/desktop-release.md).

Questions, bug reports, and feature requests: [GitHub Issues](https://github.com/amosblomqvist/learnharness/issues).

## License

[AGPL-3.0](LICENSE)

The app is free and open forever. If we ever charge for anything, it will be for convenience — managed keys, hosting — never for features you can run locally.
