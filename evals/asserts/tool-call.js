/**
 * Custom assertion for tool-use evals.
 *
 * Usage in YAML test cases:
 *   assert:
 *     - type: javascript
 *       value: file://asserts/tool-call.js
 *       config:
 *         tool: get_balance
 *         args:                       # keys that MUST be present and match
 *           address: "0xd8dA…"
 *           chain: ["ethereum", "eth", "mainnet", "1", 1]
 *         argsAbsent: [chain]         # keys that MUST NOT be present
 *
 * `args` values may be a single value (exact match) or an array (any-of match,
 * case-insensitive string comparison).
 * Omit a key from `args` to skip the check for that argument.
 * `argsAbsent` is an array of arg names the model must not include in input.
 */
module.exports = (output, ctx) => {
  const cfg = (ctx && ctx.config) || {};
  const expectedTool = cfg.tool;
  const expectedArgs = cfg.args || {};
  const expectedAbsent = Array.isArray(cfg.argsAbsent) ? cfg.argsAbsent : [];

  // Anthropic provider can return: the message object, the content array, or a JSON string of either.
  let parsed = output;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (e) {
      return { pass: false, score: 0, reason: `output not parseable: ${e.message}` };
    }
  }
  // Possible shapes promptfoo / anthropic provider hands us:
  //   1) the full Message: { content: [ ...blocks... ] }
  //   2) the content array: [ ...blocks... ]
  //   3) a single content block: { type: "tool_use", name, input } or { type: "text", text }
  let call = null;
  if (Array.isArray(parsed)) {
    call = parsed.find((b) => b && b.type === "tool_use");
  } else if (parsed && Array.isArray(parsed.content)) {
    call = parsed.content.find((b) => b && b.type === "tool_use");
  } else if (parsed && parsed.type === "tool_use") {
    call = parsed;
  } else if (parsed && parsed.type === "text") {
    return { pass: false, score: 0, reason: `model returned text, not a tool_use: "${String(parsed.text).slice(0, 120)}"` };
  } else {
    return {
      pass: false,
      score: 0,
      reason: `unexpected output shape: ${JSON.stringify(parsed).slice(0, 200)}`,
    };
  }

  if (!call) {
    return { pass: false, score: 0, reason: "model returned no tool_use block" };
  }

  if (expectedTool && call.name !== expectedTool) {
    return {
      pass: false,
      score: 0,
      reason: `expected tool "${expectedTool}", got "${call.name}"`,
    };
  }

  for (const [k, v] of Object.entries(expectedArgs)) {
    const actual = call.input?.[k];
    if (actual === undefined) {
      return { pass: false, score: 0, reason: `missing arg "${k}" in tool call` };
    }
    const allowed = Array.isArray(v) ? v : [v];
    const ok = allowed.some((a) => String(a).toLowerCase() === String(actual).toLowerCase());
    if (!ok) {
      return {
        pass: false,
        score: 0,
        reason: `arg "${k}" expected one of ${JSON.stringify(allowed)}, got ${JSON.stringify(actual)}`,
      };
    }
  }

  // Absence check — assert the model did NOT include these args.
  for (const k of expectedAbsent) {
    if (call.input && Object.prototype.hasOwnProperty.call(call.input, k)) {
      return {
        pass: false,
        score: 0,
        reason: `arg "${k}" was expected to be absent, but model set it to ${JSON.stringify(call.input[k])}`,
      };
    }
  }

  return { pass: true, score: 1, reason: `correct tool ${call.name} with valid args` };
};
