// Human in the Loop - Bản dùng createAgent (humanInTheLoopMiddleware)
// Cùng bài toán "duyệt tay trước khi gọi Tool" như 04-human-approval-manual-graph.js,
// nhưng dùng `createAgent` + middleware thay vì tự dựng StateGraph với `interruptBefore`.
//
// Khác biệt so với bản manual-graph:
//   - Chặn theo TÊN TOOL cụ thể (`interruptOn: { web_search: true }`), không chặn theo
//     tên Node.
//   - Không có `getState()`/`stream(null, thread)`. Khi bị chặn, `agent.invoke()` trả về
//     `result.__interrupt__` chứa yêu cầu duyệt.
//   - Muốn chạy tiếp: gọi lại `agent.invoke(new Command({ resume: { decisions } }), thread)`
//     với quyết định approve/edit/reject cho từng Tool call đang chờ.

require("../_polyfill");
require("dotenv").config();
const readline = require("node:readline/promises");

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
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let result = await agent.invoke(
    { messages: [{ role: "user", content: "Whats the weather in SF?" }] },
    thread,
  );

  // result.__interrupt__ còn giá trị -> vẫn đang chờ duyệt Tool. Hỏi lặp lại vì Model có
  // thể cần gọi Tool nhiều lần liên tiếp.
  while (result.__interrupt__) {
    const interruptRequest = result.__interrupt__[0];
    console.log(
      "\n-> Tool đang chờ duyệt:",
      interruptRequest.value.actionRequests,
    );

    const answer = await rl.question("Đồng ý cho chạy Tool? (y/n) ");
    // 1 quyết định cho MỖI Tool call đang chờ trong yêu cầu này.
    const decisions = interruptRequest.value.actionRequests.map(() =>
      answer === "y"
        ? { type: "approve" }
        : { type: "reject", message: "Người dùng từ chối" },
    );

    // Chạy tiếp bằng Command({ resume }) - khác cách "truyền null" ở bản manual-graph.
    result = await agent.invoke(new Command({ resume: { decisions } }), thread);

    // Debug: in ra kết quả thật mà Tool trả về (nhận diện qua field `tool_call_id`, chỉ
    // ToolMessage mới có) - nếu Tool fail (vd: lỗi mạng), nội dung sẽ là thông báo lỗi từ
    // catch() trong tool.js chứ không phải dữ liệu Wikipedia thật.
    const toolMessage = result.messages.findLast((m) => m.tool_call_id);
    if (toolMessage) console.log("\n[Tool trả về]:", toolMessage.content);
  }

  rl.close();
  console.log("\n>>> KẾT QUẢ CUỐI:", result.messages.at(-1).content);
}

main();
