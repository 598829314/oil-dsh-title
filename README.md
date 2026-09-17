# oil-dsh-title

A DeepSeek Harness plugin that keeps session titles useful as the work evolves.
It adapts the naming rules from [oil-codex-title](https://github.com/oil-oil/oil-codex-title) to DSH's official session APIs.

## Install

From the DSH Market, search for **Oil DSH Title** and install it. The direct GitHub Release equivalent is:

```sh
dsh plugin --profile web add https://github.com/598829314/oil-dsh-title/releases/latest/download/oil-dsh-title.tgz
```

Use `--profile desktop` when managing a desktop profile directly.

After installation, send a substantive user prompt in any live session. The title is updated asynchronously after the request route is known.

## Title format

Titles use:

```text
category emoji + object｜ongoing goal
```

Examples:

- `🧩 session-title｜event listener verification`
- `🎨 login form｜layout refinement`
- `🔎 model benchmark｜accuracy comparison`

The plugin considers the latest user messages, keeps the dominant language, preserves product and code names, avoids repeating the workspace hint, and avoids known title conflicts. It keeps a stable title when the work has not materially changed.

## DSH integration

This is a host-only Cordis bundle. It listens to `session/event` for all live sessions and updates titles with the official `sessionTitle.rename()` API.

It deliberately does **not** call `sessionTitle.register()` and does not disable DSH's built-in first-prompt provider. That makes it safe to install alongside the default title stack and avoids modifying DSH core files.

The plugin sends only a bounded title-generation input to the selected session route:

- the latest five user messages, each capped at 600 characters;
- the current title;
- a workspace leaf-name hint, never the full path;
- a bounded list of other live session titles.

It does not append a naming message to the conversation. Model failures, invalid output, timeouts, and title conflicts leave the current title unchanged.

## Development

```sh
npm test
npm run check
```

The tests cover title structure validation, privacy rejection, JSON parsing, mixed-language-safe normalization, and both `text-delta` and `block-end` LLM stream output.

## Attribution and license

Naming policy and the original Codex implementation: [oil-oil/oil-codex-title](https://github.com/oil-oil/oil-codex-title).

This DSH adaptation is released under the MIT License.
