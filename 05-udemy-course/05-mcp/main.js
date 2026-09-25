// =======================================================================
// MCP CLIENT + AGENT: GỌI TOOL CỦA MATH SERVER (stdio) + WEATHER SERVER (SSE)
//
// Luồng hoạt động:
// 1. Math: Client tự khởi chạy math-server.js làm tiến trình con (subprocess).
// 2. Weather: Client kết nối qua HTTP tới weather-server.js đang chạy sẵn.
// 3. Lấy tool từ cả 2 server, chuyển đổi thành tool của LangChain rồi gộp lại.
// 4. Đưa tool cho agent để LLM tự chọn: add / multiply / get_weather.
//
// CÁCH CHẠY (tại thư mục gốc project):
// 1. Terminal 1 — Bật weather server (giữ nguyên terminal này):
//    node 05-udemy-course/05-mcp/servers/weather-server.js
// 2. Terminal 2 — Chạy client:
//    node 05-udemy-course/05-mcp/main.js
//   -> Không cần chạy math-server trước, client sẽ tự khởi động.
//
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const path = require("path");

const { HumanMessage } = require("@langchain/core/messages");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { loadMcpTools } = require("@langchain/mcp-adapters");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { SSEClientTransport } = require("@modelcontextprotocol/sdk/client/sse.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const { createAgent } = require("langchain");

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
});

// ===== MATH SERVER (stdio) =====
// Sử dụng __dirname để lấy đúng đường dẫn tuyệt đối của file hiện tại,
// giúp chạy lệnh thành công từ bất kỳ thư mục nào.
const mathTransport = new StdioClientTransport({
  command: "node",
  args: [path.join(__dirname, "servers", "math-server.js")],
});
const mathClient = new Client({ name: "math-client", version: "1.0.0" });

// ===== WEATHER SERVER (SSE) =====
// Chỉ cần URL, không cần đường dẫn file. Server phải được bật trước.
const weatherTransport = new SSEClientTransport(
  new URL("http://localhost:8000/sse"),
);
const weatherClient = new Client({ name: "weather-client", version: "1.0.0" });

// Gửi 1 câu hỏi cho agent và in câu trả lời cuối
async function ask(agent, question) {
  const result = await agent.invoke({
    messages: [new HumanMessage(question)],
  });
  console.log(`\nQ: ${question}`);
  console.log(`A: ${result.messages.at(-1).content}`);
}

async function main() {
  try {
    // Kết nối, tự động spawn server và hoàn tất bắt tay thiết lập phiên
    await mathClient.connect(mathTransport);
    console.log("math session initialized");

    // Kết nối tới server đang chạy sẵn ở cổng 8000
    await weatherClient.connect(weatherTransport);
    console.log("weather session initialized");

    // Chuyển đổi tool MCP sang tool LangChain rồi gộp lại
    // (Tham số đầu tiên là tên server, dùng làm tiền tố/prefix cho tên tool nếu cần)
    const mathTools = await loadMcpTools("math", mathClient);
    const weatherTools = await loadMcpTools("weather", weatherClient);
    const tools = [...mathTools, ...weatherTools];

    // Khởi tạo agent với model và bộ công cụ vừa chuẩn bị
    const agent = createAgent({ model: llm, tools });

    // LLM tự chọn đúng tool theo câu hỏi
    await ask(agent, "What is 54 + 2 * 3?");
    await ask(agent, "What is the weather in Hanoi?");
  } finally {
    // Đảm bảo đóng kết nối thủ công để tắt tiến trình server khi kết thúc
    // (weather server vẫn chạy vì không phải do client này khởi động)
    await mathClient.close();
    await weatherClient.close();
  }
}

main();
