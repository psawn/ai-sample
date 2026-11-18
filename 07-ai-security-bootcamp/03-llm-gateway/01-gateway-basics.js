require("../../_shared/polyfill");

// =======================================================================
// LLM GATEWAY 1: BIFROST — GỌI GEMINI QUA GATEWAY
//
// Mục đích: bật Bifrost (LLM gateway open source, tự chạy trên máy), gọi Gemini qua gateway,
// so với gọi thẳng, gắn nhãn vào log.
//
// 1. LLM gateway là gì?
//    - Lớp trung gian giữa app và LLM provider (Gemini, OpenAI, Claude...).
//        App → Bifrost (localhost:8090) → Gemini
//    - App chỉ gọi gateway. Gateway lo retry, fallback, chia tải, cache, ghi log.
//    - Đổi model, provider: sửa config gateway, không sửa code app.
//    - Cấu hình chủ yếu nằm ở gateway. Request chỉ gửi thêm `fallbacks` và vài header.
//
// 2. Virtual key và API key của provider
//        App --(virtual key)--> Bifrost --(API key của provider)--> Gemini
//    - API key của provider (GEMINI_API_KEY, GROQ_API_KEY): key thật do Google, Groq cấp.
//      Provider tính tiền theo key này. Chỉ gateway giữ (mục `providers` trong config).
//    - Virtual key (sk-bf-...): key mình tự đặt, app gửi trong header `x-bf-vk`.
//      Chỉ Bifrost hiểu, provider không hề biết key này.
//    - Bifrost nhận request:
//      + Provider lấy từ tên model trong request (VD `gemini/gemini-3.5-flash`).
//        Model không ghi provider (VD `gemini-3.5-flash`) → virtual key chọn provider theo `weight`.
//      + Kiểm tra virtual key: được gọi provider, model này không? Còn budget không?
//      + Hợp lệ → gọi provider bằng API key của provider đó. Không hợp lệ → chặn.
//    - Mỗi virtual key có luật riêng (provider nào, budget bao nhiêu, tool nào).
//      Gateway nhìn key trong request để biết áp luật nào.
//    - Lộ virtual key → thu hồi riêng key đó, app khác vẫn chạy.
//      API key của provider không lộ, không phải đổi.
//
// 3. Config gateway (bifrost-config.json). Sửa xong phải restart gateway.
//    Phần dùng chung cho mọi bài (phần riêng giải thích ở file dùng nó):
//    - setup_token: mã tạo tài khoản admin, lấy từ biến môi trường BIFROST_SETUP_TOKEN.
//    - config_store: database SQLite lưu config, nằm trong Docker volume.
//      + `path` phải nằm trong /app/data (volume), không thì tạo lại container là mất.
//      + Khởi động: Bifrost nạp file config vào database, rồi chạy theo database.
//      + Nhờ có database → sửa được config trên UI, qua API (VD thêm key Gemini ở trang
//        Model Providers). Restart vẫn còn, nhưng `docker compose down -v` sẽ mất.
//      + `enabled: false` → không dùng database, chỉ sửa được bằng file.
//    - providers: provider và key thật.
//      + gemini: key Gemini (GEMINI_API_KEY).
//        Có nhiều key Gemini → gateway chia request giữa các key theo `weight` của key.
//      + groq: key Groq (GROQ_API_KEY).
//    - governance.virtual_keys: 3 virtual key, giá trị lấy từ .env.
//      + `provider_configs`: các provider virtual key được gọi. Provider không có trong danh sách → bị chặn (403).
//        `key_ids`: được dùng API key nào của provider đó (`*` = mọi key).
//        `weight`: tỉ lệ chọn provider khi model không ghi provider (0 = không chọn).
//      + `vk-main` (BIFROST_VIRTUAL_KEY): key mặc định, dùng ở hầu hết các bài. Không giới hạn budget.
//        `disable_content_logging: false` → log lưu cả câu hỏi, câu trả lời.
//        Câu hỏi có dữ liệu cá nhân → đặt `true` để log không lưu nội dung.
//      + `vk-budget-demo`, `vk-mcp-demo`: key riêng cho 05-budget-and-prompt.js và 06-mcp.js.
//
// 4. Luồng file:
//    - Phần 0: Baseline — gọi thẳng Gemini, không qua gateway, để so sánh
//    - Phần 1: Gọi qua gateway
//    - Phần 2: Metadata — gắn user, session, feature vào log
//
// 5. Chuẩn bị: bật gateway (cần Docker Desktop, chạy lệnh ở thư mục gốc repo).
//    Các bài khác trong thư mục này đều cần bước này.
//    - .env cần có:
//      + GEMINI_API_KEY, GROQ_API_KEY: key thật của provider.
//      + BIFROST_SETUP_TOKEN: mã tự đặt, dùng để tạo tài khoản admin.
//        Bifrost bắt có mã này, để người lạ không vào UI.
//      + BIFROST_VIRTUAL_KEY, BIFROST_BUDGET_VK, BIFROST_MCP_VK: tự đặt, dạng sk-bf-<chuỗi ngẫu nhiên>.
//        Bifrost tự tạo 3 virtual key từ config.
//    - Bật:
//        docker compose --env-file .env -f 07-ai-security-bootcamp/03-llm-gateway/docker-compose.yml up -d
//    - Mở http://localhost:8090, nhập BIFROST_SETUP_TOKEN, tạo tài khoản admin. Log cũng xem ở đây.
//    - Ngoài config, virtual key cũng tạo được ở trang Virtual Keys của UI.
//      Key tạo trên UI phải có giá trị khác 3 key trong .env, không thì bị trùng.
//    - Muốn dùng Groq thay Gemini: xem "Đổi sang Groq" trong helpers/bifrost.js.
//
// Chạy lệnh:
//    node 07-ai-security-bootcamp/03-llm-gateway/01-gateway-basics.js
// =======================================================================

require("dotenv").config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

const { logInfo, logQuestion, logStep } = require("../helpers/log");

const {
  PRIMARY_MODEL,
  chatViaBifrost,
  logAnswer,
  runLesson,
} = require("./helpers/bifrost");

const geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// =======================================================================
// PHẦN 0: BASELINE — GỌI THẲNG GEMINI, KHÔNG QUA GATEWAY
// =======================================================================

/**
 * Gọi thẳng Gemini bằng SDK của Google, để so sánh.
 *
 * - App phải giữ key Gemini. Không log tập trung, không retry, không fallback.
 * - Đổi provider phải đổi SDK, sửa code.
 */
async function baseline() {
  logStep("Phần 0: Baseline — gọi thẳng Gemini, không gateway");

  const geminiModel = geminiClient.getGenerativeModel({
    model: "gemini-3.5-flash",
  });
  const question = "Kubernetes là gì? Trả lời 1 câu.";
  logQuestion(question);
  const startedAt = Date.now();
  const result = await geminiModel.generateContent(question);
  logAnswer(
    result.response.text(),
    Date.now() - startedAt,
    "gọi thẳng, không gateway",
  );
}

// =======================================================================
// PHẦN 1: GỌI QUA GATEWAY
// =======================================================================

/**
 * Cùng câu hỏi Phần 0, nhưng gọi qua Bifrost.
 *
 * - Đổi provider chỉ cần đổi tên model. VD `openai/gpt-4o`.
 * - Xem log ở http://localhost:8090: token, chi phí, thời gian chạy.
 */
async function basicGatewayCall() {
  logStep("Phần 1: Gọi qua gateway");

  const question = "Kubernetes là gì? Trả lời 1 câu.";
  logQuestion(question);
  const result = await chatViaBifrost({
    model: PRIMARY_MODEL,
    messages: [{ role: "user", content: question }],
  });
  logAnswer(result.answer, result.latencyMs, `model: ${result.servedModel}`);
}

// =======================================================================
// PHẦN 2: METADATA — GẮN USER, SESSION, FEATURE VÀO LOG
// =======================================================================

/**
 * Gắn nhãn vào log bằng header `x-bf-lh-<tên nhãn>`.
 *
 * - VD `x-bf-lh-user: alice` → log có nhãn `user = alice`.
 * - Tên nhãn tự đặt, VD `user`, `session-id`, `feature`.
 * - Dùng để lọc log: user nào tốn token nhất, feature nào chậm nhất.
 * - `x-bf-lh-session-id` chỉ là nhãn log. Khác header `x-bf-session-id` dùng để giữ nguyên model
 *   (session affinity, trong 02-retry-fallback-routing.js).
 * - Dùng ID nội bộ, không dùng email hay SĐT → tránh lộ dữ liệu cá nhân qua log.
 */
async function metadataTagging() {
  logStep("Phần 2: Metadata — gắn user, session, feature vào log");

  const sessionId = Math.random().toString(36).slice(2, 10);
  const userRequests = [
    {
      user: "alice",
      feature: "enterprise-rag",
      question: "Kubernetes RBAC là gì?",
    },
    {
      user: "bob",
      feature: "docs-chatbot",
      question: "BGP chọn đường đi thế nào?",
    },
    {
      user: "alice",
      feature: "enterprise-rag",
      question: "Kubernetes NetworkPolicy là gì?",
    },
  ];

  for (const { user, feature, question } of userRequests) {
    logQuestion(`[${user} | ${feature}] ${question}`);
    const result = await chatViaBifrost(
      { model: PRIMARY_MODEL, messages: [{ role: "user", content: question }] },
      {
        "x-bf-lh-user": user,
        "x-bf-lh-session-id": sessionId,
        "x-bf-lh-feature": feature,
      },
    );
    logAnswer(result.answer, result.latencyMs);
  }
  logInfo("→ Xem kết quả: mở http://localhost:8090 → Dashboard → Metadata");
}

async function main() {
  await baseline(); // Phần 0
  await basicGatewayCall(); // Phần 1
  await metadataTagging(); // Phần 2
}

runLesson(main, ["GEMINI_API_KEY", "BIFROST_VIRTUAL_KEY"]);
