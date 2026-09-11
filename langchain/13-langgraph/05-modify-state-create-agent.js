// Human in the Loop - Bản dùng createAgent (sửa Tool call bằng decision "edit")
// Cùng bài toán "sửa Tool call trước khi cho chạy tiếp" như 05-modify-state-manual-graph.js,
// nhưng dùng `createAgent` + `humanInTheLoopMiddleware` thay vì tự dựng StateGraph.
//
// Khác biệt so với bản manual-graph:
//   - Bản manual-graph phải tự đọc `state.values.messages`, sửa tay `tool_calls`, rồi gọi
//     `updateState()` - vì reducer của MessagesAnnotation tự thay thế message trùng `id`.
//   - Bản này không cần đụng tới message/id gì cả: chỉ cần trả về quyết định
//     `{ type: "edit", editedAction: { name, args } }` khi resume - middleware tự lo phần
//     còn lại (tương đương "sửa state" nhưng qua 1 API rõ ràng hơn).

require("../_polyfill");
require("dotenv").config();

const { createAgent, humanInTheLoopMiddleware } = require("langchain");
const { MemorySaver, Command } = require("@langchain/langgraph");
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

  // interruptOn: { web_search: true } -> mỗi lần Model gọi Tool "web_search" đều bị chặn
  // lại chờ duyệt, tương đương interruptBefore: ["action"] ở bản manual-graph.
  const hitlMiddleware = humanInTheLoopMiddleware({
    interruptOn: { web_search: true },
  });

  const agent = createAgent({
    model: llm,
    tools: [webSearch],
    systemPrompt: prompt,
    checkpointer: memory,
    middleware: [hitlMiddleware],
  });

  const thread = { configurable: { thread_id: "1" } };

  let result = await agent.invoke(
    { messages: [{ role: "user", content: "Whats the weather in LA?" }] },
    thread,
  );

  const originalAction = result.__interrupt__[0].value.actionRequests[0];
  console.log("\nTool call ban đầu Model muốn gọi:", originalAction);

  // Decision "edit": đổi thẳng tên/args của Tool call, không cần biết message id là gì.
  const decisions = [
    {
      type: "edit",
      editedAction: {
        name: originalAction.name,
        args: { query: "current weather in Louisiana" },
      },
    },
  ];

  console.log("\n========== Chạy tiếp với Tool call đã sửa ==========");
  // Command({ resume }) chạy tiếp Graph đang bị interrupt() tạm dừng, gửi `decisions` vào
  // đúng chỗ đang chờ để middleware biết cách xử lý Tool call (xem thêm giải thích ở
  // 04-human-approval-create-agent.js).
  result = await agent.invoke(new Command({ resume: { decisions } }), thread);
  console.log("\n>>> KẾT QUẢ CUỐI:", result.messages.at(-1).content);
}

main();
