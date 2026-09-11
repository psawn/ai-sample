// Hàm dùng chung: biến 1 Zod schema thành 1 "function tool" theo đúng format
// mà model.withConfig({ tools, tool_choice }) cần (xem 01-function-calling.js).
// Đây là format function-calling chuẩn chung (nhiều model, bao gồm Gemini,
// đều hỗ trợ), không phải thứ chỉ dành riêng cho OpenAI.
const { zodToJsonSchema } = require("zod-to-json-schema");

function zodToFunctionTool(name, description, zodSchema) {
  // zodToJsonSchema() sinh thêm field "$schema" (metadata, model không cần) ->
  // loại bỏ cho parameters gọn hơn.
  const { $schema, ...parameters } = zodToJsonSchema(zodSchema);

  return {
    type: "function",
    function: { name, description, parameters },
  };
}

module.exports = { zodToFunctionTool };
