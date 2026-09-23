// =======================================================================
// FUNCTIONS, TOOLS & AGENTS - UTIL: ZOD SCHEMA -> "FUNCTION TOOL"
//
// Đổi Zod schema thành "function tool", đúng format
// model.withConfig({ tools, tool_choice }) cần (xem 01-function-calling.js).
//
// Format này là chuẩn chung của function calling, không riêng OpenAI.
// Gemini cũng hỗ trợ.
// =======================================================================

const { zodToJsonSchema } = require("zod-to-json-schema");

// Vd: zodToFunctionTool("Tagging", "Tag the text", schema)
//   -> { type: "function", function: { name: "Tagging", description, parameters } }
function zodToFunctionTool(name, description, zodSchema) {
  // Bỏ "$schema": metadata model không cần.
  const { $schema, ...parameters } = zodToJsonSchema(zodSchema);

  return {
    type: "function",
    function: { name, description, parameters },
  };
}

module.exports = { zodToFunctionTool };
