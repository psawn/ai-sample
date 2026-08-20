// =======================================================
// Tagging: dùng function calling để "gắn nhãn" 1 đoạn text theo các tiêu
// chí định sẵn (sentiment, ngôn ngữ, ...), thay vì để LLM trả lời tự do.
//
// Ý tưởng:
// 1. Định nghĩa 1 Zod schema mô tả những nhãn cần gắn.
// 2. Biến schema đó thành 1 "function tool" (xem util-zod-to-tool.js).
// 3. Ép model luôn gọi đúng tool này (tool_choice = tên tool) -> model trả
//    về đúng cấu trúc dữ liệu mong muốn trong tool_calls, không lẫn chữ thừa.
// =======================================================
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

// Schema mô tả nhãn cần gắn cho 1 đoạn text.
const taggingSchema = z.object({
  sentiment: z
    .string()
    .describe("sentiment of text, should be `pos`, `neg`, or `neutral`"),
  language: z.string().describe("language of text (should be ISO 639-1 code)"),
});

const taggingTool = zodToFunctionTool(
  "Tagging",
  "Tag the piece of text with particular info.",
  taggingSchema,
);

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "Think carefully, and then tag the text as instructed"],
  ["human", "{input}"],
]);

// tool_choice: điều khiển model có bắt buộc gọi tool hay không.
// - "auto": model tự quyết định có cần gọi tool hay không.
// - "any": model bắt buộc phải gọi 1 trong các tool được truyền vào.
// - "none": cấm model gọi bất kỳ tool nào.
// - "<tên tool>" (như "Tagging" ở đây): ép model luôn gọi đúng tool đó.
//   Đây chỉ là 1 chuỗi thường, phải gõ khớp tay với taggingTool.function.name
//   Có thể dùng taggingTool.function.name để tránh gõ lệch
const modelWithTagging = model.withConfig({
  tools: [taggingTool],
  tool_choice: "Tagging",
});

const taggingChain = prompt.pipe(modelWithTagging);

// RunnableLambda lấy args của tool_call đầu tiên -> trả thẳng ra object JSON
// đã gắn nhãn, thay vì cả 1 AIMessage.
const extractFirstToolArgs = RunnableLambda.from(
  (aiMessage) => aiMessage.tool_calls[0].args,
);

const taggingChainWithParser = taggingChain.pipe(extractFirstToolArgs);

async function main() {
  const result1 = await taggingChain.invoke({ input: "I love langchain" });
  console.log("\n=== 1. Tagging: 'I love langchain' (raw tool_calls) ===");
  console.log(result1.tool_calls);

  const result2 = await taggingChain.invoke({
    input: "non mi piace questo cibo",
  });
  console.log(
    "\n=== 2. Tagging: 'non mi piace questo cibo' (raw tool_calls) ===",
  );
  console.log(result2.tool_calls);

  // Cùng câu hỏi trên nhưng đi qua extractFirstToolArgs -> ra thẳng object
  // { sentiment, language } gọn hơn, không cần tự đào vào tool_calls[0].args.
  const parsedResult = await taggingChainWithParser.invoke({
    input: "non mi piace questo cibo",
  });
  console.log("\n=== 3. Tagging + parser (chỉ lấy args) ===");
  console.log(parsedResult);
}

main();
