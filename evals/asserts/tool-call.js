/**
 * Custom assertion for tool-use evals.
 *
 * Usage in YAML test cases:
 *   assert:
 *     - type: javascript
 *       value: file://evals/asserts/tool-call.js
 *       config:
 *         tool: get_balance
 *         args:
 *           address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
 *           chain: ["ethereum", "eth", "mainnet", "1", 1]
 *
 * `args` values may be a single value (exact match) or an array (any-of match).
 * Omit a key from `args` to skip the check for that argument.
 */
module.exports = (output, ctx) => {
  const cfg = (ctx && ctx.config) || {};
  const expectedTool = cfg.tool;
  const expectedArgs = cfg.args || {};

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

  return { pass: true, score: 1, reason: `correct tool ${call.name} with valid args` };
};
