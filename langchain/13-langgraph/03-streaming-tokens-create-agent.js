// Persistence and Streaming - Phần 2: Streaming từng token (bản createAgent)
// Mục tiêu:
//   - Cùng bài toán streaming token như 03-streaming-tokens-manual-graph.js, nhưng dùng
//     `createAgent` (giống 02-persistence-create-agent.js) thay vì tự dựng StateGraph.

require("../_polyfill");
require("dotenv").config();

const { createAgent } = require("langchain");
const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { webSearch } = require("./tool");

const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  const memory = new MemorySaver();
  const agent = createAgent({
    model: llm,
    tools: [webSearch],
    systemPrompt: prompt,
    checkpointer: memory,
  });

  const thread = { configurable: { thread_id: "4" } };
  const events = agent.streamEvents(
    { messages: [{ role: "user", content: "What is the weather in SF?" }] },
    { ...thread, version: "v2" },
  );

  for await (const event of events) {
    // "on_chat_model_stream": 1 mẩu (chunk) nhỏ của câu trả lời Model vừa sinh ra.
    if (event.event === "on_chat_model_stream") {
      const content = event.data.chunk.content;
      // content rỗng nghĩa là Model đang yêu cầu gọi Tool (chưa có chữ để in) -> bỏ qua,
      // chỉ in khi thực sự có chữ.
      if (content) {
        process.stdout.write(`${content}|`);
      }
    }
  }
  console.log();
}

main();
