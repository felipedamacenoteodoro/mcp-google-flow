# Security

## Threat model

The server controls a browser signed in to your Google account. Whoever controls the server controls that session. The defences start from three assumptions:

1. **The agent can make mistakes or be misled** (prompt injection from a page, a file or a message). Every tool input is therefore validated as if it were hostile.
2. **The DevTools port is as good as your password.** It is never exposed outside the machine.
3. **Spent credits cannot be recovered.** Nothing paid happens without an approved quote for that exact request, within the session limit.

## Controls

| Risk | Control | Where |
|---|---|---|
| Reading arbitrary files (`/etc/passwd`, `~/.ssh`) through uploads | Allowed folders + `realpath` + content check by leading bytes + size limit | `infrastructure/fs/sandboxed-file-vault.ts` |
| Overwriting files through downloads (`../`, planted symlink) | Plain validated name + exclusive creation (`wx`) inside the output folder; empty files from failed downloads are removed | `application/use-cases/assets.ts`, `sandboxed-file-vault.ts` |
| Steering the signed-in session to another site | Only `https://flow.google.com`, no port or credentials in the URL | `domain/project-url.ts` |
| DevTools reachable from the network | Random port chosen by Chrome; a manual endpoint must be loopback | `infrastructure/browser/` |
| Leaking cookies or passwords from the personal profile | Dedicated profile with `0700` permissions; the personal profile is never read or copied | `chrome-launcher.ts` |
| Script injection into the page | User values travel as `evaluate` arguments or keystrokes; selectors quote labels as CSS strings | `infrastructure/flow/flow-page.ts` and the adapters next to it |
| Hidden text in prompts | Control, zero-width and bidirectional-override characters are removed | `domain/prompt.ts` |
| Runaway or blind spending | Single-use quote bound to the exact request and price (valid 10 minutes); per-session credit budget; hourly limit; an unknown price never counts as zero; attachments re-checked before the click | `application/spend-guard.ts`, `domain/spend-ledger.ts` |
| Paid clicks inside third-party tools | Buttons that look like generating ("Generate", "Render", "Create"…) require a quote | `domain/tools.ts` |
| Invisible characters in the code (Trojan Source) | A test fails if any bidi or zero-width character appears in the repository | `tests/infrastructure/ui-parsing.test.ts` |
| Tokens and email in logs | Logs go to stderr only, with masking | `infrastructure/system/logger.ts` |
| Internal details exposed to the agent | Domain errors carry a code and a message; anything else becomes a generic `INTERNAL` | `interface/mcp/tool-result.ts` |

## Still your responsibility

- The Google login and the account you use.
- What you send to Flow and what Flow generates.
- Complying with Google's Terms of Service.
- `flow_capture_screen` returns the screen as it is and may show the account's email.

## Reporting a vulnerability

Use GitHub's "Report a vulnerability" on this repository, or open an issue **without** exploitable details and ask for a private channel.
