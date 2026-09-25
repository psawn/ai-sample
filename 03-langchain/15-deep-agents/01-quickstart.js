// =======================================================================
// DEEP AGENTS - BƯỚC 1: QUICKSTART
//
// Agent nghiên cứu: tự search web rồi viết câu trả lời.
// Theo doc: https://docs.langchain.com/oss/javascript/deepagents/quickstart
//
// Chỉ khai báo model + 1 tool + system prompt, giống createAgent.
// Khác ở chỗ: createDeepAgent tự thêm sẵn các tool khác:
// - ls, read_file, write_file, edit_file, glob, grep: đọc ghi filesystem ảo (lưu trong state).
//   Kết quả search quá dài thì agent ghi ra file, không nhồi hết vào messages.
// - task: giao việc cho subagent "general-purpose" (có sẵn), chạy với context riêng.
//
// So sánh bản createAgent: ../13-langgraph/01b-components-create-agent.js
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { TavilySearch } = require("@langchain/tavily");
const { createDeepAgent } = require("deepagents");
const { tool } = require("langchain");
const { z } = require("zod");

// Bước 1: tool search web (Tavily, cần TAVILY_API_KEY).
const internetSearch = tool(
  async ({
    query,
    maxResults = 5,
    topic = "general",
    includeRawContent = false,
  }) => {
    const tavilySearch = new TavilySearch({
      maxResults,
      tavilyApiKey: process.env.TAVILY_API_KEY,
      includeRawContent,
      topic,
    });
    return await tavilySearch._call({ query });
  },
  {
    name: "internet_search",
    description: "Run a web search",
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results to return"),
      topic: z
        .enum(["general", "news", "finance"])
        .optional()
        .default("general")
        .describe("Search topic category"),
      includeRawContent: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to include raw content"),
    }),
  },
);

// Bước 2: system prompt, dặn agent làm nhà nghiên cứu.
const researchInstructions = `You are an expert researcher. Your job is to conduct thorough research and then write a polished report.

You have access to an internet search tool as your primary means of gathering information.

## \`internet_search\`

Use this to run an internet search for a given query. You can specify the max number of results to return, the topic, and whether raw content should be included.
`;

// Bước 3: tạo deep agent.
const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const agent = createDeepAgent({
  model,
  tools: [internetSearch],
  systemPrompt: researchInstructions,
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Bước 4: chạy agent.
  const result = await agent.invoke({
    messages: [{ role: "user", content: "What is langgraph?" }],
  });

  // Các tool agent đã gọi: thấy được agent có ghi file hay giao việc cho subagent không.
  const toolCalls = result.messages.flatMap(
    (message) => message.tool_calls ?? [],
  );
  console.log(
    `🔧 Tool đã gọi: ${toolCalls.map((call) => call.name).join(", ")}`,
  );
  console.log(
    `📁 File trong filesystem ảo: ${Object.keys(result.files ?? {}).join(", ") || "(không có)"}`,
  );

  console.log(`\n>>> KẾT QUẢ CUỐI:\n${result.messages.at(-1).content}\n`);
}

main();
