// =======================================================================
// FUNCTIONS, TOOLS & AGENTS - BƯỚC 3: TAGGING (GẮN NHÃN CHO ĐOẠN TEXT)
//
// Dùng function calling để gắn nhãn text theo tiêu chí định sẵn
// (cảm xúc, ngôn ngữ...), thay vì để LLM trả lời tự do.
//
// Flow:
// 1. Zod schema: mô tả các nhãn cần gắn.
// 2. Đổi schema thành "function tool" (util-zod-to-tool.js).
// 3. Ép model luôn gọi tool này (tool_choice = tên tool).
// 4. Đọc nhãn từ tool_calls[0].args: đúng cấu trúc, không lẫn chữ thừa.
//
// Model không chạy tool nào cả. Tool chỉ là "khuôn" để model điền dữ liệu.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { RunnableLambda } = require("@langchain/core/runnables");
const { zodToFunctionTool } = require("./util-zod-to-tool");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Các nhãn cần gắn: cảm xúc (sentiment) + ngôn ngữ (language).
const taggingSchema = z.object({
  sentiment: z
    .string()
    .describe("sentiment of text, should be `pos`, `neg`, or `neutral`"),
  language: z.string().describe("language of text (should be ISO 639-1 code)"),
});

// Đổi schema thành function tool tên "Tagging".
const taggingTool = zodToFunctionTool(
  "Tagging",
  "Tag the piece of text with particular info.",
  taggingSchema,
);

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "Think carefully, and then tag the text as instructed"],
  ["human", "{input}"],
]);

// tool_choice: điều khiển việc gọi tool.
// - "auto": model tự quyết định.
// - "any": bắt buộc gọi 1 trong các tool được truyền vào.
// - "none": cấm gọi tool.
// - "<tên tool>": luôn gọi đúng tool đó (ở đây là "Tagging").
//   Phải khớp taggingTool.function.name. Dùng thẳng biến đó để tránh gõ sai.
const modelWithTagging = model.withConfig({
  tools: [taggingTool],
  tool_choice: "Tagging",
});

// Chain: prompt -> model (bị ép gọi Tagging). Output là AIMessage có tool_calls.
const taggingChain = prompt.pipe(modelWithTagging);

// Lấy args của tool_call đầu tiên -> ra thẳng object nhãn, thay vì cả AIMessage.
const extractFirstToolArgs = RunnableLambda.from(
  (aiMessage) => aiMessage.tool_calls[0].args,
);

const taggingChainWithParser = taggingChain.pipe(extractFirstToolArgs);

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Case 1: câu tiếng Anh, tích cực -> kỳ vọng sentiment "pos", language "en".
  const result1 = await taggingChain.invoke({ input: "I love langchain" });
  console.log("\n=== 1. Tagging: 'I love langchain' (raw tool_calls) ===");
  console.log(result1.tool_calls);

  // Case 2: câu tiếng Ý ("tôi không thích món này") -> kỳ vọng "neg", "it".
  const result2 = await taggingChain.invoke({
    input: "non mi piace questo cibo",
  });
  console.log(
    "\n=== 2. Tagging: 'non mi piace questo cibo' (raw tool_calls) ===",
  );
  console.log(result2.tool_calls);

  // Case 3: cùng câu trên, thêm extractFirstToolArgs
  // -> ra thẳng { sentiment, language }, không cần tự lấy tool_calls[0].args.
  const parsedResult = await taggingChainWithParser.invoke({
    input: "non mi piace questo cibo",
  });
  console.log("\n=== 3. Tagging + parser (chỉ lấy args) ===");
  console.log(parsedResult);
}

main();
