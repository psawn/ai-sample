// =======================================================================
// MCP SERVER: ĐƠN HÀNG (Transport = Streamable HTTP)
//
// MCP server tự viết, dùng ở Phần 4 của 06-mcp.js. Có 2 tool:
//   - lookup_order: xem trạng thái đơn hàng. Chỉ đọc → để Bifrost tự gọi.
//   - refund_order: hoàn tiền đơn hàng. Có tác động thật → bắt app duyệt trước.
// Dữ liệu và việc hoàn tiền đều giả lập, lưu trong RAM. Restart server là về như cũ.
//
// Streamable HTTP: chuẩn mới của MCP, thay cho SSE (05-udemy-course/05-mcp/servers/weather-server.js).
//   - Chỉ 1 endpoint: POST /mcp. Client gửi request, server trả kết quả luôn.
//   - Stateless: mỗi request tạo server mới, không nhớ session → code đơn giản.
//
// Cách chạy: docker-compose.yml tự bật server này (service `order-mcp`), không cần chạy tay.
//   - Bifrost gọi tới bằng tên service: http://order-mcp:3001/mcp.
//   - Máy mình gọi được qua http://localhost:3001/mcp, VD để test bằng MCP Inspector:
//       npx @modelcontextprotocol/inspector
//     → Transport Type: Streamable HTTP, URL: http://localhost:3001/mcp → Connect → Tools.
// =======================================================================

const {
  createMcpExpressApp,
} = require("@modelcontextprotocol/sdk/server/express.js");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

const PORT = 3001;

// Dữ liệu giả. Dùng chung cho mọi request → hoàn tiền xong, lần xem sau thấy trạng thái mới.
const orders = {
  A1001: { status: "giao thất bại", amountVnd: 500000 },
  A1002: { status: "đã giao", amountVnd: 1200000 },
};

/** Gói text thành kết quả tool theo định dạng MCP. */
function textResult(text) {
  return { content: [{ type: "text", text }] };
}

/**
 * Tạo 1 MCP server có 2 tool.
 *
 * - Tên, mô tả, tham số của tool khai báo ở đây. Bifrost hỏi danh sách tool rồi đưa cho model.
 * - Model chỉ đọc mô tả để chọn tool → mô tả phải rõ tool làm gì.
 */
function createServer() {
  const server = new McpServer({ name: "orders", version: "1.0.0" });

  server.registerTool(
    "lookup_order",
    {
      description: "Xem trạng thái và số tiền của 1 đơn hàng.",
      inputSchema: { orderId: z.string().describe("Mã đơn hàng, VD A1001") },
    },
    async ({ orderId }) => {
      const order = orders[orderId];
      return textResult(
        order
          ? `Đơn ${orderId}: ${order.status}, ${order.amountVnd} VND`
          : `Không có đơn ${orderId}`,
      );
    },
  );

  server.registerTool(
    "refund_order",
    {
      description: "Hoàn tiền toàn bộ 1 đơn hàng cho khách.",
      inputSchema: {
        orderId: z.string().describe("Mã đơn hàng, VD A1001"),
        reason: z.string().describe("Lý do hoàn tiền"),
      },
    },
    async ({ orderId, reason }) => {
      const order = orders[orderId];
      if (!order) return textResult(`Không có đơn ${orderId}`);
      order.status = "đã hoàn tiền"; // giả lập hoàn tiền: chỉ đổi trạng thái
      console.log(`💸 Đã hoàn tiền đơn ${orderId}. Lý do: ${reason}`);
      return textResult(
        `Đã hoàn ${order.amountVnd} VND cho đơn ${orderId}`,
      );
    },
  );

  return server;
}

// host 0.0.0.0: nhận kết nối từ container khác (Bifrost), không chỉ từ chính container này.
// allowedHosts: chỉ nhận request có Host là 2 tên này → chặn DNS rebinding
// (trang web lạ lừa trình duyệt gọi vào server trên máy mình).
const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts: ["order-mcp", "localhost"],
});

app.post("/mcp", async (req, res) => {
  // sessionIdGenerator: undefined → stateless, mỗi request 1 server + 1 transport mới
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Order MCP server đang chạy: http://localhost:${PORT}/mcp`);
});
