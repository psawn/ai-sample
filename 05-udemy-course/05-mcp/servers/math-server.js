// =======================================================================
// MCP SERVER: MATH (Transport = stdio)
//
// - Cung cấp 2 tool: add, multiply.
// - Cơ chế stdio: Client tự mở file này làm process con, giao tiếp qua stdin/stdout.
//   => Không cần mở port, không cần chạy trước server.
//
// LƯU Ý LỚN:
// - KHÔNG dùng console.log ở đây vì stdout dành riêng cho dữ liệu MCP.
// - Cần ghi log thì dùng console.error (ghi ra stderr).
//
// CÁCH CHẠY (tại thư mục gốc project):
// 1. Dùng MCP Inspector (giao diện web, Node >= 22.19):
//    npx @modelcontextprotocol/inspector node 05-udemy-course/05-mcp/servers/math-server.js
//    -> Bấm Connect -> tab Tools -> List Tools -> chọn add -> nhập a, b -> Run Tool.
//
// 2. Chạy trực tiếp "node math-server.js" sẽ thấy treo:
//    Đây là bình thường vì server đang đợi lệnh JSON-RPC từ client.
//
// LƯU Ý VỀ ĐƯỜNG DẪN:
// - Đường dẫn tương đối dựa vào thư mục bạn đang đứng khi gõ lệnh.
//   Đứng sai thư mục sẽ bị lỗi MODULE_NOT_FOUND.
// - Nếu đứng thư mục khác, dùng đường dẫn tuyệt đối:
//    npx @modelcontextprotocol/inspector node D:/Test/ai/05-udemy-course/05-mcp/servers/math-server.js
// - Trên giao diện Inspector (ô Arguments): Bắt buộc dùng dấu `/`.
//   Dấu `\` sẽ bị nuốt mất (ví dụ: D:\Test\ai\... biến thành D:Testai...).
// - Trong config của MCP Client (Claude Desktop, Cursor...): Nên dùng đường dẫn tuyệt đối
//   vì client mở server từ thư mục bạn không quản lý được.
// =======================================================================

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

// Khởi tạo MCP Server
const server = new McpServer({ name: "Math", version: "1.0.0" });

// Khai báo tool "add"
// Cần mô tả rõ description và schema đầu vào (inputSchema dùng Zod)
server.registerTool(
  "add",
  {
    description: "Cộng hai số nguyên",
    inputSchema: { a: z.number().int(), b: z.number().int() },
  },
  // Kết quả tool bắt buộc trả về đúng chuẩn { content: [...] }
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
);

// Khai báo tool "multiply"
server.registerTool(
  "multiply",
  {
    description: "Nhân hai số nguyên",
    inputSchema: { a: z.number().int(), b: z.number().int() },
  },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a * b) }] }),
);

// Kết nối server qua cổng stdio
async function main() {
  await server.connect(new StdioServerTransport());
  console.error("Math MCP server đang chạy (stdio)");
}

main();
