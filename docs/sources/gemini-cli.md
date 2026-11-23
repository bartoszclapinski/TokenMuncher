# Gemini CLI as a usage source

What Google's Gemini CLI (`@google/gemini-cli`) keeps on disk, what TokenMuncher reads from it, and what it leaves alone. The reader is `src/main/sources/gemini.js`.

## How sure this is

The format below comes from Gemini CLI's chat recording code (`ChatRecordingService` in `packages/core`), as shipped in the 2025 releases that introduced automatic session recording, and the `Storage` class that names its folders. It was written down **from that code, not checked against a machine with Gemini CLI installed**, and not re-checked against the newest release. Treat it the way the README treats Codex: tested on a fabricated file only.

The parser is built so that a format change shows up as missing data, not as wrong data:

- it reads only files named `session-*.json` under `chats/` folders, and only fields listed here;
- a file that is not one JSON object with a `messages` array is skipped and counted;
- a message without a `tokens` object adds no usage;
- `session-*.jsonl` files in a `chats/` folder are not read, only counted (`jsonlSessionFilesNotRead` in the diagnostics), so a release that moved to a line-per-record format shows up there instead of being parsed by guesswork;
- *Settings → about → copy diagnostics* shows how many files and messages were recognised and which message types were skipped.

If the numbers look wrong, that report is the place to start.

### Not confirmed, check on a real install before release

These parts are implemented but could not be checked against a machine with Gemini CLI or against its current source:

| Point | What the reader does if it is wrong |
|---|---|
| sessions are `chats/session-*.json`, one JSON object each | nothing is read; `filesTracked` is 0, or `jsonlSessionFilesNotRead` is above 0 |
| `GEMINI_CLI_HOME` moves the data to `$GEMINI_CLI_HOME/.gemini` | with the variable set, nothing is found; the report shows the folder that was looked at |
| `.project_root` holds the project path | projects are named `gemini-<hash>` or after the folder, as in older releases |
| an answer's `tokens` are written after the answer itself (first `null`, then filled in) and may be rewritten | handled either way: see "When a file changes" below |

To check: run one short Gemini CLI session with a tool call, then open the newest file under `~/.gemini/tmp/*/chats/` and compare its fields with the tables below, and copy the diagnostics from TokenMuncher.

## Where things are

The Gemini CLI home is `~/.gemini` (`%USERPROFILE%\.gemini` on Windows). Newer releases honour `GEMINI_CLI_HOME` in place of the home folder, so the data is in `%GEMINI_CLI_HOME%\.gemini`. TokenMuncher follows the same rule. This override is the least certain part of the folder layout. If `GEMINI_CLI_HOME` is set and nothing shows up, the diagnostics report gives the folder that was looked at.

| Path | What it is | Read by TokenMuncher |
|---|---|---|
| `~/.gemini/tmp/<project>/chats/session-<date>T<time>-<id>.json` | one recorded chat session | **yes** |
| `~/.gemini/tmp/<project>/.project_root` | the project's folder path, one line (newer releases; not confirmed, used only if present) | **yes**, only to name the project |
| `~/.gemini/tmp/<project>/logs.json` | the user's prompts (text only, no tokens) | no |
| `~/.gemini/tmp/<project>/checkpoint-*.json` | chats saved with `/chat save` (full history, no tokens) | no |
| `~/.gemini/settings.json` | user settings | no |
| `~/.gemini/oauth_creds.json`, `google_accounts.json` | the Google login | **no, never** |
| `~/.gemini/installation_id` and other files in `~/.gemini` | ids, caches, extensions | no |

`<project>` is one folder per project directory Gemini CLI was started in. In the releases this was written against it is the SHA-256 hash of the project's path (64 hex digits), so the path cannot be recovered from the folder name. Newer releases may use a short readable name and a `.project_root` file instead. The project shown in TokenMuncher is, in this order:

1. the last folder of the path in `.project_root`, when that file exists;
2. the folder name, when it is not a 64-digit hash;
3. otherwise `gemini-` and the first 8 digits of the hash. Sessions of one project still group together, but the project's real name is not known.

## A session file

One JSON object, **rewritten as a whole** every time a message is added or updated (not appended line by line). A file that stops changing is a finished or paused session; resuming a session continues the same file.

### When a file changes

TokenMuncher reads the whole file again and goes through every message:

- the session exists from its first `"gemini"` answer, even before that answer has tokens, so tool calls written before the tokens are kept on it;
- an answer is counted once, by its `id`. If its `tokens` change in a later rewrite, the counted numbers are replaced by the new ones (counted in the diagnostics as `answersUpdated`), not added a second time;
- tool calls are kept once, by their `id`.

```jsonc
{
  "sessionId": "string (uuid)",
  "projectHash": "string (sha-256 hex of the project path)",
  "startTime": "ISO 8601",
  "lastUpdated": "ISO 8601",
  "summary": "string (optional)",
  "messages": [ /* MessageRecord, oldest first */ ]
}
```

### MessageRecord

Every message has:

| Field | Type | Used |
|---|---|---|
| `id` | string, unique in the session | key that stops a message being counted twice when the file is rewritten |
| `timestamp` | ISO 8601 | time of the usage |
| `type` | `"user"`, `"gemini"`, `"info"`, `"error"`, `"warning"` | only `"gemini"` carries usage |
| `content` | the message text or parts | **never read** |

A `"gemini"` message (one model answer) may also have:

| Field | Type | Used |
|---|---|---|
| `model` | string, e.g. `gemini-2.5-pro` | model name and price |
| `tokens` | TokensSummary or `null` | token counts |
| `toolCalls` | array of ToolCallRecord | the tool name for the activity list |
| `thoughts` | array of thought summaries | **never read** |

### TokensSummary

Copied by Gemini CLI from the Gemini API's `usageMetadata` of that answer:

| Field | From `usageMetadata` | Meaning |
|---|---|---|
| `input` | `promptTokenCount` | the whole prompt, **including** the cached part |
| `cached` | `cachedContentTokenCount` | the part of the prompt read from the cache |
| `output` | `candidatesTokenCount` | the answer |
| `thoughts` | `thoughtsTokenCount` (optional) | thinking tokens, billed as output |
| `tool` | `toolUsePromptTokenCount` (optional) | tool-use prompt tokens, billed as input |
| `total` | `totalTokenCount` | everything above, cached part counted once |

TokenMuncher turns that into its own record:

- fresh input = `input − cached + tool`
- cache reads = `cached`
- output = `output + thoughts`
- cache writes = 0 (Gemini CLI does not report them)

The last answer's `input` is also shown as the session's context use, out of 1,048,576 tokens (the context window of the Gemini 2.5 and 3 models).

### ToolCallRecord

| Field | Type | Used |
|---|---|---|
| `id` | string | key of the activity entry |
| `name` | string, e.g. `run_shell_command`, `read_file` | shown |
| `args` | object | only `command` (first line, up to 100 characters), or `file_path` / `absolute_path` / `path` (shown relative to the project when possible) |
| `timestamp` | ISO 8601 | time of the activity entry |
| `status`, `result`, `resultDisplay`, `description`, `displayName` | | **never read** |

These are shown only inside the app, in the same way as Claude Code and Codex commands, and are not part of the diagnostics report.

## Limits and plan

Gemini CLI keeps **no limits on disk**. Its quotas (requests per minute and per day, which depend on the login type) live on Google's side; `/stats` shows only the current run. TokenMuncher shows Gemini CLI as *usage only*: tokens, sessions, activity and an API-price equivalent, but no limit bars, forecasts or limit notifications.

Asking Google's servers for the quota would mean reading the Google login from `oauth_creds.json` and sending it to Google. That is allowed by CONTRIBUTING.md (a login only goes to its own tool's server), but it is left out on purpose: nothing about Gemini CLI is sent anywhere.

## Prices

The "API equivalent" uses approximate Gemini API list prices (`GEMINI` in `src/main/pricing.js`, standard tier, prompts up to 200k tokens). Many Gemini CLI users are on a free tier, so this is what the same tokens would cost on the paid API, not what they paid.

## Network

None. The Gemini CLI source reads local files only and sends nothing.
