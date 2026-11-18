require("../../_shared/polyfill");

// =======================================================================
// LLM GATEWAY 6: BIFROST — MCP QUA GATEWAY
//
// Mục đích: cho model gọi tool của MCP server qua gateway, kiểm soát tool nào được chạy
// theo virtual key, tool nào phải để app duyệt trước.
//
// 1. MCP qua gateway là gì?
//    - MCP (Model Context Protocol): chuẩn chung để LLM gọi tool bên ngoài.
//      Tool khai báo trên MCP server (tên, mô tả, tham số), không khai báo trong code app.
//    - LLM không tự gọi tool, chỉ trả về "gọi tool nào, param gì" → phải có bên khác gọi.
//    - Không có gateway: app làm hết.
//        App gửi câu hỏi + danh sách tool → LLM trả tool + param → App gọi tool
//        → App gửi kết quả cho LLM → LLM trả lời
//    - Có gateway: Bifrost làm thay app.
//      + Bifrost khởi động → hỏi MCP server có tool gì → giữ sẵn danh sách.
//      + App chỉ gửi câu hỏi → Bifrost gắn danh sách tool → gửi LLM.
//      + LLM trả tool + param → Bifrost xử lý tùy tool:
//          Tool tự gọi   → Bifrost gọi tool, gửi kết quả cho LLM → app chỉ nhận câu trả lời cuối
//          Tool cần duyệt → Bifrost dừng, trả tool + param về app → app duyệt mới nhờ Bifrost gọi
//    - Header `x-bf-mcp-include-tools`: chọn tool cho request này (tên dạng `<server>-<tool>`).
//      + Không gửi → model nhận mọi tool key được dùng.
//      + Gửi rỗng → không đưa tool nào.
//      + Chỉ thu hẹp được, không mở rộng quyền của key.
//
// 2. Config dùng trong file này (bifrost-config.json):
//    - mcp.client_configs: MCP server gateway kết nối tới.
//      + deepwiki: MCP server công khai, không cần key. Có 3 tool đọc tài liệu repo GitHub:
//        `read_wiki_structure`, `ask_wiki_question`, `read_wiki_contents`.
//      + `tools_to_execute`: tool nào của server được dùng. `["*"]` = tất cả.
//      + `tools_to_auto_execute`: tool Bifrost tự gọi, không cần app duyệt. deepwiki chỉ để `read_wiki_structure`.
//        Tool không có trong danh sách này → Bifrost không tự gọi, trả về app để duyệt (Phần 2).
//      + Ghi sai tên tool → không báo lỗi, tool chỉ không có. Xem tên đúng ở trang MCP của UI.
//      + orders: MCP server tự viết (servers/order-server.js), docker-compose.yml tự bật.
//        2 tool: `lookup_order` (chỉ đọc, tự chạy), `refund_order` (hoàn tiền, phải duyệt).
//    - `vk-mcp-demo` (BIFROST_MCP_VK): virtual key riêng cho file này. Chỉ dùng Gemini.
//      + `mcp_configs`: key này được dùng 2 tool của deepwiki (`read_wiki_structure`, `ask_wiki_question`)
//        và 2 tool của orders. Tool `read_wiki_contents` bị chặn để thử ở Phần 3.
//      + Key nào không có `mcp_configs` → không dùng được tool nào.
//        VD `vk-main` → các bài khác không bị gắn thêm tool.
//
// 3. Bảo mật:
//    - Chỉ cho tự chạy tool chỉ đọc. Tool ghi, xóa, gửi mail → bắt duyệt.
//    - Kết quả tool là dữ liệu từ ngoài, có thể chứa lệnh giấu (indirect prompt injection).
//      Gateway chỉ kiểm soát được tool nào được chạy, không kiểm tra nội dung kết quả.
//
// 4. Luồng file:
//    - Phần 1: Tool tự chạy — Bifrost tự gọi tool, app chỉ nhận câu trả lời cuối
//    - Phần 2: Tool cần duyệt — Bifrost trả `tool_calls` về app, app duyệt rồi mới chạy
//    - Phần 3: Tool bị chặn — key không có quyền thì model không thấy tool, gọi thẳng bị 403
//    - Phần 4: MCP server tự viết — tool đọc tự chạy, tool hoàn tiền bị app từ chối
//
// 5. Chuẩn bị: bật gateway theo phần Chuẩn bị trong 01-gateway-basics.js (cần BIFROST_MCP_VK).
//    Lệnh bật đó cũng bật MCP server đơn hàng cho Phần 4.
//
// Chạy lệnh:
//    node 07-ai-security-bootcamp/03-llm-gateway/06-mcp.js
// =======================================================================

require("dotenv").config();

const { logInfo, logQuestion, logStep } = require("../helpers/log");

const {
  BIFROST_URL,
  bifrostClient,
  chatViaBifrost,
  logAnswer,
  runLesson,
} = require("./helpers/bifrost");

// Key MCP chỉ cho dùng Gemini → luôn dùng Gemini, không theo PRIMARY_MODEL
const MCP_MODEL = "gemini/gemini-3.5-flash";
// Gửi key MCP thay key mặc định → request được dùng tool theo quyền của key này
const MCP_VK_HEADER = { "x-bf-vk": process.env.BIFROST_MCP_VK };
// Phần 1 và 3 hỏi cùng 1 câu → so được câu trả lời có tool và không có tool
const STRUCTURE_QUESTION =
  "Tài liệu của repo GitHub maximhq/bifrost gồm những phần chính nào? Trả lời 2 câu.";

/**
 * Nhờ Bifrost gọi 1 tool mà model xin chạy.
 *
 * - Body: gửi nguyên object tool call model trả về (`id`, `type`, `function`).
 * - Bifrost kiểm tra lại quyền của virtual key trước khi gọi → không có quyền thì 403.
 * - Gọi bằng fetch: SDK OpenAI không có hàm cho endpoint riêng này của Bifrost.
 */
async function executeMcpTool(toolCall) {
  const response = await fetch(`${BIFROST_URL}/v1/mcp/tool/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...MCP_VK_HEADER },
    body: JSON.stringify(toolCall),
  });
  return { status: response.status, body: await response.json() };
}

// =======================================================================
// PHẦN 1: TOOL TỰ CHẠY — APP CHỈ NHẬN CÂU TRẢ LỜI CUỐI
// =======================================================================

/**
 * Chỉ đưa tool `read_wiki_structure` (có trong `tools_to_auto_execute`).
 *
 * - Bifrost tự gọi tool trên MCP server, gửi kết quả cho model, lặp tới khi model trả lời xong.
 * - App gửi 1 request, nhận 1 câu trả lời, không thấy bước gọi tool.
 */
async function autoExecuteTool() {
  logStep("Phần 1: Tool tự chạy");

  logQuestion(`[Tool tự chạy] ${STRUCTURE_QUESTION}`);
  const result = await chatViaBifrost(
    {
      model: MCP_MODEL,
      messages: [{ role: "user", content: STRUCTURE_QUESTION }],
    },
    {
      ...MCP_VK_HEADER,
      "x-bf-mcp-include-tools": "deepwiki-read_wiki_structure",
    },
  );
  logAnswer(result.answer, result.latencyMs, "Bifrost tự gọi tool");
}

// =======================================================================
// PHẦN 2: TOOL CẦN DUYỆT — APP DUYỆT RỒI MỚI CHẠY
// =======================================================================

/**
 * Chỉ đưa tool `ask_wiki_question` (không có trong `tools_to_auto_execute`).
 *
 * - Bifrost không tự gọi tool, trả `tool_calls` (model xin gọi tool nào) về app.
 * - App duyệt → gọi `/v1/mcp/tool/execute` → gửi kết quả lại cho model → model trả lời.
 */
async function approveBeforeExecute() {
  logStep("Phần 2: Tool cần duyệt");

  const question =
    "Repo GitHub maximhq/bifrost: virtual key dùng để làm gì? Trả lời 1 câu.";
  logQuestion(`[Tool cần duyệt] ${question}`);
  const messages = [{ role: "user", content: question }];
  const first = await bifrostClient.chat.completions.create(
    { model: MCP_MODEL, messages },
    {
      headers: {
        ...MCP_VK_HEADER,
        "x-bf-mcp-include-tools": "deepwiki-ask_wiki_question",
      },
    },
  );
  const modelMessage = first.choices[0].message;
  if (!modelMessage.tool_calls) {
    logInfo(`Model không gọi tool, trả lời luôn: ${modelMessage.content}`);
    return;
  }

  // Gửi lại nguyên message của model: có thể chứa chữ ký suy luận Gemini cần để trả lời tiếp
  messages.push(modelMessage);
  for (const toolCall of modelMessage.tool_calls) {
    logInfo(
      `Model xin chạy: ${toolCall.function.name} ${toolCall.function.arguments.replace(/\s+/g, " ")}`,
    );
    // App thật: hỏi user hoặc kiểm tra luật (tool nào, tham số nào) trước khi cho chạy
    logInfo("✅ Duyệt → app nhờ Bifrost gọi tool");
    const toolResult = await executeMcpTool(toolCall);
    messages.push(toolResult.body); // { role: "tool", tool_call_id, content }
  }

  // Header rỗng = không đưa tool nào → model phải trả lời, không xin chạy tool lần nữa
  const second = await chatViaBifrost(
    { model: MCP_MODEL, messages },
    { ...MCP_VK_HEADER, "x-bf-mcp-include-tools": "" },
  );
  logAnswer(second.answer, second.latencyMs, "app duyệt rồi mới chạy tool");
}

// =======================================================================
// PHẦN 3: TOOL BỊ CHẶN — KEY KHÔNG CÓ QUYỀN
// =======================================================================

/**
 * Thử dùng `read_wiki_contents` (key không được dùng). Gateway chặn ở 2 lớp:
 *
 * - Lúc gửi model: header xin tool này cũng không được → model không nhận được tool nào,
 *   tự trả lời từ kiến thức cũ (có thể sai, so với câu trả lời Phần 1).
 * - Lúc chạy: app cố gọi thẳng tool → gateway trả 403 `mcp_tool_blocked`.
 */
async function blockedTool() {
  logStep("Phần 3: Tool bị chặn theo virtual key");

  // Lớp 1: header xin tool không có quyền → model không nhận được tool
  logQuestion(`[Xin tool không có quyền] ${STRUCTURE_QUESTION}`);
  const result = await chatViaBifrost(
    {
      model: MCP_MODEL,
      messages: [{ role: "user", content: STRUCTURE_QUESTION }],
    },
    {
      ...MCP_VK_HEADER,
      "x-bf-mcp-include-tools": "deepwiki-read_wiki_contents",
    },
  );
  logAnswer(
    result.answer,
    result.latencyMs,
    "không có tool → model tự trả lời từ kiến thức cũ, có thể sai",
  );

  // Lớp 2: app cố gọi thẳng tool không có quyền → 403
  const blocked = await executeMcpTool({
    id: "call_manual",
    type: "function",
    function: {
      name: "deepwiki-read_wiki_contents",
      arguments: JSON.stringify({ repoName: "maximhq/bifrost" }),
    },
  });
  logInfo(
    `Gọi thẳng deepwiki-read_wiki_contents → ${blocked.status}: ${blocked.body.error?.message}`,
  );
}

// =======================================================================
// PHẦN 4: MCP SERVER TỰ VIẾT — TOOL ĐỌC TỰ CHẠY, TOOL HOÀN TIỀN BỊ TỪ CHỐI
// =======================================================================

/**
 * Khách nhờ kiểm tra rồi hoàn tiền đơn A1001. Dùng 2 tool của MCP server tự viết (servers/order-server.js).
 *
 * - Request 1: Bifrost tự gọi `lookup_order` (tool đọc), gửi kết quả cho model.
 *   Model muốn gọi tiếp `refund_order` → tool này phải duyệt → Bifrost dừng, trả `tool_calls` về app.
 *   + `content`: Bifrost tóm tắt kết quả các tool đã tự gọi.
 *   + `finish_reason` vẫn là `stop` → kiểm tra `tool_calls`, đừng dựa vào `finish_reason`.
 * - App từ chối: không gọi tool, gửi lý do cho model dưới dạng kết quả tool → model báo lại khách.
 * - Kiểm tra lại đơn: vẫn "giao thất bại" → tool hoàn tiền chưa từng chạy.
 */
async function selfHostedServer() {
  logStep(
    "Phần 4: MCP server tự viết — tool đọc tự chạy, tool ghi phải duyệt",
  );

  const question =
    "Đơn A1001 của tôi giao thất bại. Kiểm tra đơn rồi hoàn tiền giúp tôi.";
  logQuestion(question);
  const messages = [{ role: "user", content: question }];
  const first = await bifrostClient.chat.completions.create(
    { model: MCP_MODEL, messages },
    {
      headers: {
        ...MCP_VK_HEADER,
        "x-bf-mcp-include-tools": "orders-lookup_order,orders-refund_order",
      },
    },
  );
  const modelMessage = first.choices[0].message;
  logInfo(
    `Bifrost đã tự gọi tool đọc: ${modelMessage.content.replace(/\s+/g, " ")}`,
  );
  if (!modelMessage.tool_calls) {
    logInfo("Model không xin hoàn tiền.");
    return;
  }

  messages.push(modelMessage);
  for (const toolCall of modelMessage.tool_calls) {
    logInfo(
      `Model xin chạy: ${toolCall.function.name} ${toolCall.function.arguments.replace(/\s+/g, " ")}`,
    );
    // Giả lập nhân viên từ chối. App thật: hiện nút Duyệt / Từ chối, hoặc kiểm tra luật (số tiền, quyền user)
    logInfo("❌ Từ chối → app không gọi tool, chỉ báo lý do cho model");
    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: "Bị từ chối: hoàn tiền cần nhân viên chăm sóc khách hàng xác nhận.",
    });
  }

  // Header rỗng = không đưa tool nào → model chỉ trả lời khách, không xin chạy tool lần nữa
  const second = await chatViaBifrost(
    { model: MCP_MODEL, messages },
    { ...MCP_VK_HEADER, "x-bf-mcp-include-tools": "" },
  );
  logAnswer(second.answer, second.latencyMs, "app từ chối, tool không chạy");

  // Gọi thẳng tool đọc để kiểm tra: đơn chưa bị hoàn tiền
  const check = await executeMcpTool({
    id: "call_check",
    type: "function",
    function: {
      name: "orders-lookup_order",
      arguments: JSON.stringify({ orderId: "A1001" }),
    },
  });
  logInfo(`Kiểm tra lại → ${check.body.content}`);
}

async function main() {
  await autoExecuteTool(); // Phần 1
  await approveBeforeExecute(); // Phần 2
  await blockedTool(); // Phần 3
  await selfHostedServer(); // Phần 4
}

runLesson(main, ["BIFROST_MCP_VK"]);
