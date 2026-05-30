# Evals

Regression tests for `mcp-evm`'s tool selection. Built on [promptfoo](https://promptfoo.dev).

## What it checks

For each test prompt, the eval calls the Anthropic API with the same tool definitions this MCP exposes (cached in `tools.json`) and asserts:

- The model chose the right **tool** for the prompt.
- The model passed the right **arguments** (chain alias, address, sort, etc.).

Runs against **Haiku 4.5** as the cheap/fast baseline. An Opus 4.7 provider is wired up but commented out — promptfoo (`0.120.x`) still sends a default `temperature` param which Opus 4.7 deprecated, so it 400s. Re-enable once promptfoo drops the default or exposes a way to suppress it.

## Run locally

```bash
export ANTHROPIC_API_KEY=...
npm run eval         # run the suite, print pass/fail summary
npm run eval:view    # open the local web UI to inspect results
```

## Run in CI

```bash
npm run eval:ci      # same as `eval` but skips the response cache; exits non-zero on any failure
```

Wire into a GitHub Action that runs on PRs touching `src/tools.ts` or `evals/`.

## Layout

```
evals/
  promptfooconfig.yaml   ← test cases
  tools.json             ← cached Anthropic tool schemas (mirror of buildToolList() output)
  asserts/
    tool-call.js         ← custom assertion: tool name + arg matching
```

## Adding a test case

```yaml
- description: "describe the prompt class"
  vars:
    user: "actual user prompt"
  assert:
    - type: javascript
      value: file://asserts/tool-call.js
      config:
        tool: get_balance
        args:
          chain: [ethereum, eth, "1", 1]   # any-of match
          address: "0x..."                  # exact match
```

Omit `args` keys you don't want to check. Pass an array for any-of; a single value for exact match.
