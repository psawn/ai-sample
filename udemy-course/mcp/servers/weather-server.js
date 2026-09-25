// =======================================================================
// MCP SERVER: WEATHER (Transport = SSE)
//
// - Cung cấp 1 tool: get_weather.
// - Cơ chế SSE: Server chạy độc lập như web server, client kết nối qua HTTP.
//   => Phải bật server trước thì client mới kết nối được.
//
// Luồng hoạt động:
//   GET  http://localhost:8000/sse     -> Client mở luồng SSE để nhận dữ liệu
//   POST http://localhost:8000/messages  -> Client gửi request lên server
//
// LƯU Ý: SSE hiện đã deprecated, chuẩn mới là Streamable HTTP.
// Vẫn dùng SSE ở đây để bám sát nội dung course.
//
// CÁCH CHẠY (tại thư mục gốc project):
// 1. Terminal 1 — Bật server (giữ nguyên terminal này):
//    node udemy-course/mcp/servers/weather-server.js
// 2. Terminal 2 — Test bằng MCP Inspector (giao diện web, Node >= 22.19):
//    npx @modelcontextprotocol/inspector
//    -> Chọn Transport Type: SSE, URL: http://localhost:8000/sse
//    -> Bấm Connect -> tab Tools -> List Tools -> chọn get_weather -> nhập location -> Run Tool.
//
// LƯU Ý VỀ ĐƯỜNG DẪN:
// - Chỉ cần chú ý đường dẫn ở bước 1 (lệnh node). Nếu đứng sai thư mục, dùng đường dẫn tuyệt đối:
//    node D:/Test/ai/udemy-course/mcp/servers/weather-server.js
// - Client không cần quan tâm đường dẫn file, chỉ cần gọi đúng URL http://localhost:8000/sse.
// =======================================================================

const {
  createMcpExpressApp,
} = require("@modelcontextprotocol/sdk/server/express.js");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  SSEServerTransport,
} = require("@modelcontextprotocol/sdk/server/sse.js");
const { z } = require("zod");

const PORT = 8000;

// Mỗi client kết nối cần một McpServer riêng -> dùng hàm tạo
function createServer() {
  const server = new McpServer({ name: "Weather", version: "1.0.0" });

  // Khai báo tool "get_weather"
  server.registerTool(
    "get_weather",
    {
      description: "Get weather for location.",
      inputSchema: { location: z.string() },
    },
    async ({ location }) => ({
      content: [{ type: "text", text: "Hot as hell" }],
    }),
  );

  return server;
}

// Express app tích hợp sẵn tính năng bảo vệ chống DNS rebinding cho localhost
const app = createMcpExpressApp();

// Lưu trữ transport theo sessionId để biết POST /messages cần gửi đến client nào
const transports = {};

// 1. Xử lý khi client mở kết nối SSE
app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  // Dọn dẹp bộ nhớ khi client ngắt kết nối
  res.on("close", () => delete transports[transport.sessionId]);

  await createServer().connect(transport);
});

// 2. Xử lý khi client gửi message kèm tham số ?sessionId=... trên URL
app.post("/messages", async (req, res) => {
  const transport = transports[req.query.sessionId];
  if (!transport) return res.status(400).send("Không tìm thấy session");

  await transport.handlePostMessage(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`Weather MCP server đang chạy: http://localhost:${PORT}/sse`);
});
