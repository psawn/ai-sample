require("../../_shared/polyfill");

// =======================================================================
// LLM GATEWAY 1: BIFROST — GỌI GEMINI QUA GATEWAY
//
// Mục đích: gọi Gemini qua Bifrost (LLM gateway open source, tự chạy trên máy) và thử
// các tính năng: log, retry, fallback, chia tải, cache, streaming, budget, prompt.
//
// 1. LLM gateway là gì?
//    - Lớp trung gian giữa app và LLM provider (Gemini, OpenAI, Claude...).
//        App → Bifrost (localhost:8090) → Gemini
//    - App chỉ gọi gateway. Gateway lo retry, fallback, chia tải, cache, ghi log.
//    - Đổi model, provider: sửa config gateway, không sửa code app.
//
// 2. Gọi Bifrost từ code
//    - Bifrost dùng định dạng API của OpenAI → dùng package `openai`, đổi `baseURL` sang gateway.
//    - Tên model: `provider/model`. VD `gemini/gemini-3.5-flash`.
//      + Ghi rõ provider → luôn gọi đúng provider đó. File này đều ghi rõ, trừ Phần 7.
//      + Không ghi provider (VD `gemini-3.5-flash`) → vẫn chạy, gateway tự chọn provider theo `weight` (mục 4).
//        Nhưng đổi `weight` là có thể bị gửi sang provider khác → chỉ bỏ provider khi cần, như Phần 7.
//    - Cấu hình chủ yếu nằm ở gateway. Request chỉ gửi thêm `fallbacks` và vài header.
//    - Mọi request phải gửi virtual key trong header `x-bf-vk`.
//      + Virtual key: key gateway cấp cho app, dùng thay key thật của provider.
//      + Lộ virtual key thì key thật vẫn an toàn (chỉ nằm ở gateway), thu hồi lại được.
//
// 3. Retry và fallback (Phần 3–5)
//    - Retry: gửi lại cho cùng model. Fallback: chuyển sang model dự phòng.
//    - Model lỗi thì gateway xử lý theo loại lỗi:
//      + Lỗi tạm thời (mất mạng, provider sập, quá tải) → retry tối đa 3 lần → vẫn lỗi → fallback.
//        Mỗi lần retry chờ lâu hơn lần trước (0.5s → 1s → 2s).
//      + Lỗi do request (sai tên model, sai tham số) → fallback luôn, vì gửi lại vẫn sai.
//      + Quá 30s chưa trả lời (timeout) → fallback luôn, để user không phải chờ thêm 30s nữa.
//      + Model dự phòng lỗi → cũng xử lý y như trên.
//    - Fallback khai báo được ở 2 chỗ:
//      + Trong request (Phần 3): app gửi `fallbacks` trong body.
//        → Mỗi request chọn được dự phòng riêng.
//        → Nhưng request nào quên gửi là không có dự phòng. Đổi model dự phòng phải sửa code.
//      + Trong config (Phần 4): khai báo `fallbacks` trong routing rule.
//        → App không cần gửi `fallbacks` trong body. Đổi model dự phòng chỉ cần sửa config.
//        → Nhưng áp chung cho mọi request khớp luật.
//    - Retry làm user chờ lâu hơn (Phần 5):
//      → Provider sập → chờ hết 3 lần retry (thêm khoảng 3s) rồi mới fallback.
//      → `max_retries` càng lớn, user chờ càng lâu.
//
// 4. Config gateway (bifrost-config.json). Sửa xong phải restart gateway.
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
//      + groq: key Groq (GROQ_API_KEY). Dùng ở Phần 7, Phần 13 và khi đổi sang Groq (mục 6).
//      + dead-provider: provider giả, trỏ tới cổng không có gì chạy (localhost:9999)
//        → luôn không kết nối được. Dùng ở Phần 5 để giả lập provider sập.
//        Khởi động gateway sẽ thấy warning `failed to list models` của provider này, không sao.
//      + network_config: timeout 30s, retry tối đa 3 lần (xem mục 3).
//        Gemini và dead-provider đặt giống nhau.
//    - governance.virtual_keys: 2 virtual key, giá trị lấy từ .env.
//      + Mỗi virtual key có luật riêng (provider nào, budget bao nhiêu). Gateway nhìn key
//        trong request để biết áp luật nào.
//      + `provider_configs`: các provider key được gọi. Provider không có trong danh sách → bị chặn (403).
//      + `weight`: tỉ lệ để gateway tự chọn provider, chỉ dùng khi request không nói rõ provider.
//        → Ghi `gemini/gemini-3.5-flash` → đã nói rõ Gemini → gọi Gemini, bỏ qua weight.
//        → Chỉ ghi `gpt-4o` → chưa nói provider → gateway chọn theo weight.
//          VD OpenAI và Azure đều có `gpt-4o`, cùng `weight: 1` → mỗi bên ~50%.
//        → `weight: 0` → không bao giờ được tự chọn, chỉ gọi khi request nói rõ provider đó.
//        → Chia giữa 2 model khác nhau (VD Gemini 70%, Groq 30%) → dùng routing rule (Phần 6).
//      + `vk-main` (BIFROST_VIRTUAL_KEY): Phần 1–12, 14. Không giới hạn budget.
//        Gemini `weight: 1`, Groq và dead-provider `weight: 0`
//        → request không nói rõ provider thì luôn chọn Gemini.
//        `disable_content_logging: false` → log lưu cả câu hỏi, câu trả lời.
//        Câu hỏi có dữ liệu cá nhân → đặt `true` để log không lưu nội dung.
//      + `vk-budget-demo` (BIFROST_BUDGET_VK): Phần 13. Dùng được Gemini và Groq.
//        Cả 2 `weight: 1` nhưng không chia 50/50, vì Phần 13 luôn nói rõ provider.
//    - governance.budgets + model_configs: Gemini trong `vk-budget-demo` chỉ được $0.0001/giờ.
//      + Đặt ở model_configs (chỉ Gemini), không đặt ở cả key → Groq không bị chặn theo.
//      + Tách key riêng → chỉ Phần 13 bị kiểm tra budget, các phần khác không ảnh hưởng.
//      + Xem ở trang Budgets & Limits (trang Virtual Keys vẫn ghi "No budget", không sao).
//    - governance.routing_rules: luật chọn model.
//      Mỗi luật chỉ áp cho request có header `x-demo` tương ứng:
//      + `config-fallback-demo` (Phần 4): model chính lỗi → chuyển sang model dự phòng khai báo trong luật.
//      + `load-balance-demo` (Phần 6): chia 70/30 cho 2 model.
//      + `session-affinity-demo` (Phần 7): chia 50/50 cho Gemini và Groq. Có `fallbacks` để session giữ được model.
//      + Các luật cùng scope phải khác `priority`. Trùng → Bifrost bỏ qua luật, chỉ ghi warning trong log.
//    - vector_store + plugins.semantic_cache: bật cache, lưu trong Redis.
//      + Semantic cache: model embedding đổi câu hỏi thành vector (dãy số thể hiện ý nghĩa)
//        → câu khác chữ nhưng cùng ý vẫn trúng cache.
//      + threshold: độ giống tối thiểu (0 → 1) để trúng cache.
//        Thấp quá → trả nhầm đáp án. Cao quá → ít trúng.
//      + Muốn chỉ cache câu giống hệt: đặt `dimension: 1`, bỏ `provider` và `embedding_model`.
//
// 5. Các phần. main() chạy tất cả. Muốn chạy riêng phần nào thì comment các phần còn lại.
//    - Cơ bản:
//        Phần 0: Baseline — gọi thẳng Gemini, không qua gateway, để so sánh
//        Phần 1: Gọi qua gateway
//        Phần 2: Metadata — gắn user, session, feature vào log
//    - Fallback, retry, chia tải:
//        Phần 3: Fallback trong request — app gửi `fallbacks`
//        Phần 4: Fallback trong config — app không cần gửi `fallbacks`
//        Phần 5: Provider sập — retry hết lượt rồi mới fallback
//        Phần 6: Load balancing — chia 70/30 cho 2 model
//        Phần 7: Session affinity — cùng cuộc hội thoại thì giữ nguyên model
//    - Cache:
//        Phần 8: Cache — câu giống hệt hoặc cùng ý thì trả kết quả đã lưu
//    - Tích hợp:
//        Phần 9: LangChain
//        Phần 10: LangGraph
//        Phần 11: Streaming
//    - Gộp tất cả:
//        Phần 12: Fallback + retry + timeout + cache + metadata trong cùng 1 request
//    - Quản lý ở gateway:
//        Phần 13: Budget — hết tiền thì chặn hoặc chuyển provider
//        Phần 14: Prompt ở gateway — app chỉ gửi câu hỏi
//
// 6. Bật gateway (cần Docker Desktop, chạy lệnh ở thư mục gốc repo):
//    - .env cần có:
//      + GEMINI_API_KEY, GROQ_API_KEY: key thật của provider.
//      + BIFROST_SETUP_TOKEN: mã tự đặt, dùng để tạo tài khoản admin.
//        Bifrost bắt có mã này, để người lạ không vào UI.
//      + BIFROST_VIRTUAL_KEY, BIFROST_BUDGET_VK: tự đặt, dạng sk-bf-<chuỗi ngẫu nhiên>.
//        Bifrost tự tạo 2 virtual key từ config.
//    - Bật:
//        docker compose --env-file .env -f 07-ai-security-bootcamp/03-llm-gateway/docker-compose.yml up -d
//    - Mở http://localhost:8090, nhập BIFROST_SETUP_TOKEN, tạo tài khoản admin. Log cũng xem ở đây.
//    - Ngoài config, virtual key cũng tạo được ở trang Virtual Keys của UI.
//      Key tạo trên UI phải có giá trị khác 2 key trên, không thì bị trùng.
//    - Tạo prompt cho Phần 14 (chỉ tạo được trên UI, config không khai báo được):
//      + Trang Prompt Repository → New Prompt → thêm System message:
//        "Bạn là chuyên gia IT doanh nghiệp. Trả lời đúng 1 câu tiếng Việt, bắt đầu bằng 💡."
//        → Commit Version (thành v1).
//      + Gõ thẳng vào System message để sửa (không cần bấm bút chì) thành
//        "... Trả lời đúng 3 gạch đầu dòng." → Commit Version (thành v2).
//      + ID prompt nằm trên URL khi mở prompt: ...?promptId=<ID>. Copy vào .env: BIFROST_PROMPT_ID=...
//      + Prompt lưu trong database → `docker compose down -v` là mất.
//    - Đổi sang Groq (có gói free):
//      + Code: dùng 2 dòng PRIMARY_MODEL, FALLBACK_MODEL của Groq (đang comment).
//      + bifrost-config.json: đổi model trong routing rule `config-fallback-demo` (fallbacks),
//        `load-balance-demo` (targets) → restart gateway. `session-affinity-demo` đã có sẵn Groq.
//      + Vẫn dùng Gemini: Phần 0 (SDK của Google), Phần 13 (bài học là Gemini hết tiền → Groq),
//        embedding của semantic cache (Groq không có model embedding).
//      + Groq free giới hạn số request, token mỗi phút → chạy nhiều phần liền nhau có thể bị lỗi 429.
//
// =======================================================================

require("dotenv").config();

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { HumanMessage } = require("@langchain/core/messages");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} = require("@langchain/langgraph");
const { ToolNode } = require("@langchain/langgraph/prebuilt");
const { ChatOpenAI } = require("@langchain/openai");
const OpenAI = require("openai");

// 3 tool giả lập (không gửi mail, đặt lịch thật), dùng ở Phần 10
const {
  checkCalendarAvailability,
  scheduleMeeting,
  writeEmail,
} = require("../../03-langchain/14-email-assistant/helpers/tools");
const { logInfo, logQuestion, logStep } = require("../helpers/log");

const BIFROST_URL = "http://localhost:8090";
// Model dùng chung cho các phần. Đổi sang Groq (có gói free): xem "Đổi sang Groq" ở mục 6 đầu file.
const PRIMARY_MODEL = "gemini/gemini-3.5-flash"; // model chính
const FALLBACK_MODEL = "gemini/gemini-3.5-flash-lite"; // model dự phòng
// const PRIMARY_MODEL = "groq/openai/gpt-oss-120b";
// const FALLBACK_MODEL = "groq/openai/gpt-oss-20b";

// Phần 13: budget chỉ giới hạn Gemini → luôn dùng Gemini, không theo PRIMARY_MODEL
const BUDGET_GEMINI_MODEL = "gemini/gemini-3.5-flash";
const GROQ_MODEL = "groq/openai/gpt-oss-20b"; // Phần 13: Gemini hết tiền thì chuyển sang model này

const bifrostClient = new OpenAI({
  // baseURL: endpoint định dạng OpenAI của Bifrost, nhận thêm `fallbacks`
  baseURL: `${BIFROST_URL}/v1`,
  // apiKey: SDK bắt buộc có nên điền tạm. Key thật nằm ở gateway.
  apiKey: "not-used",
  // defaultHeaders: gửi virtual key kèm mọi request, thiếu thì lỗi 401
  defaultHeaders: { "x-bf-vk": process.env.BIFROST_VIRTUAL_KEY },
  // maxRetries: tắt retry của SDK, tránh retry chồng lên gateway
  maxRetries: 0,
});

const geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/** Chờ `ms` mili giây. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gửi 1 request qua Bifrost, trả về câu trả lời và thông tin từ gateway.
 *
 * - `body`: body của OpenAI, thêm được `fallbacks`.
 * - `headers`: header của Bifrost (cache key, metadata...).
 * - `.withResponse()`: lấy thêm response gốc để đọc header `x-bifrost-*`:
 *   + `servedModel`: model thật đã trả lời. Có thể khác model trong request (do fallback, routing rule).
 *   + `usedFallback`: có phải model dự phòng trả lời không.
 *   + `fromCache`: lấy từ cache hay gọi model thật.
 */
async function chatViaBifrost(body, headers = {}) {
  const startedAt = Date.now();
  const { data, response } = await bifrostClient.chat.completions
    .create(body, { headers })
    .withResponse();

  return {
    answer: data.choices[0].message.content,
    latencyMs: Date.now() - startedAt,
    servedModel:
      response.headers.get("x-bifrost-routing-info-model") ?? data.model,
    usedFallback:
      response.headers.get("x-bifrost-routing-info-is-fallback") === "true",
    fromCache: response.headers.get("x-bifrost-cache-hit") === "true",
  };
}

/** In câu trả lời (cắt ngắn) và thời gian chạy. */
function logAnswer(answer, latencyMs, note = "") {
  const shortAnswer =
    answer.length > 200 ? `${answer.slice(0, 200)}...` : answer;
  logInfo(`Trả lời: ${shortAnswer.replace(/\s+/g, " ")}`);
  logInfo(`⏱  ${latencyMs}ms${note ? ` | ${note}` : ""}`);
}

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
 * - `x-bf-lh-session-id` chỉ là nhãn log, khác header `x-bf-session-id` giữ model ở Phần 7.
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

// =======================================================================
// PHẦN 3: FALLBACK TRONG REQUEST — MODEL CHÍNH LỖI THÌ CHUYỂN SANG MODEL DỰ PHÒNG
// =======================================================================

/**
 * Fallback khai báo trong request: app gửi `fallbacks` (danh sách model dự phòng) trong body.
 * Model chính lỗi → gateway thử lần lượt từng model dự phòng.
 *
 * - Lần 1: model chính chạy bình thường → không dùng dự phòng.
 * - Lần 2: model không tồn tại → lỗi → chuyển sang dự phòng. App không thấy lỗi.
 */
async function requestFallback() {
  logStep("Phần 3: Fallback trong request");

  const question = "Persistent Volume Claim trong Kubernetes là gì?";

  logQuestion(`[Model chính chạy bình thường] ${question}`);
  const primaryResult = await chatViaBifrost({
    model: PRIMARY_MODEL,
    fallbacks: [FALLBACK_MODEL],
    messages: [{ role: "user", content: question }],
  });
  logAnswer(
    primaryResult.answer,
    primaryResult.latencyMs,
    `model: ${primaryResult.servedModel} | fallback: ${primaryResult.usedFallback}`,
  );

  logQuestion(`[Model chính lỗi] ${question}`);
  try {
    const fallbackResult = await chatViaBifrost({
      model: "gemini/model-khong-ton-tai",
      fallbacks: [FALLBACK_MODEL],
      messages: [{ role: "user", content: question }],
    });
    logAnswer(
      fallbackResult.answer,
      fallbackResult.latencyMs,
      `model: ${fallbackResult.servedModel} | fallback: ${fallbackResult.usedFallback}`,
    );
  } catch (error) {
    // App chỉ nhận lỗi khi cả model chính lẫn model dự phòng đều lỗi
    logInfo(
      `❌ Cả model chính và dự phòng đều lỗi: ${error.status ?? ""} ${error.message}`,
    );
  }
}

// =======================================================================
// PHẦN 4: FALLBACK TRONG CONFIG — APP KHÔNG CẦN GỬI `fallbacks`
// =======================================================================

/**
 * Fallback khai báo trong config: routing rule `config-fallback-demo` (bifrost-config.json).
 * App không gửi `fallbacks`, gateway tự chuyển sang model dự phòng.
 *
 * - Gửi 2 lần cùng 1 body (model không tồn tại, không có `fallbacks`):
 *   + Lần 1: không có header → không áp luật → lỗi về tới app.
 *   + Lần 2: header `x-demo: config-fallback` → áp luật → model chính lỗi → dùng model dự phòng.
 * - Luật trỏ tới model không tồn tại để giả lập model chính lỗi. Thực tế: luật trỏ tới model thật.
 */
async function configFallback() {
  logStep("Phần 4: Fallback trong config");

  const question = "StatefulSet trong Kubernetes là gì?";
  // Không có `fallbacks`: app không biết có model dự phòng
  const body = {
    model: "gemini/model-khong-ton-tai",
    messages: [{ role: "user", content: question }],
  };

  const attempts = [
    {
      label: "Không có luật fallback",
      headers: {},
    },
    {
      label: "Có luật fallback trong config",
      headers: { "x-demo": "config-fallback" },
    },
  ];
  for (const { label, headers } of attempts) {
    logQuestion(`[${label}] ${question}`);
    try {
      const result = await chatViaBifrost(body, headers);
      logAnswer(
        result.answer,
        result.latencyMs,
        `model: ${result.servedModel} | fallback: ${result.usedFallback}`,
      );
    } catch (error) {
      logInfo(`❌ Lỗi về tới app: ${error.message}`); // message đã có mã lỗi
    }
  }
}

// =======================================================================
// PHẦN 5: PROVIDER SẬP — RETRY HẾT LƯỢT RỒI MỚI FALLBACK
// =======================================================================

/**
 * So thời gian chờ fallback của 2 loại lỗi. Cả 2 lần đều gửi `fallbacks` trong body (giống Phần 3).
 *
 * - Lần 1: model không tồn tại → lỗi do request, không retry → fallback ngay.
 * - Lần 2: `dead-provider` (provider giả, luôn không kết nối được) → retry 3 lần → rồi mới fallback.
 * - Lần 2 chậm hơn khoảng 3s = thời gian chờ giữa các lần retry (0.5s + 1s + 2s, cộng chút ngẫu nhiên).
 */
async function retryBeforeFallback() {
  logStep("Phần 5: Provider sập — retry hết lượt rồi mới fallback");

  // Yêu cầu trả lời ngắn → thời gian model trả lời ít chênh lệch, dễ thấy thời gian retry
  const question = "DaemonSet trong Kubernetes là gì? Trả lời 1 câu.";
  const attempts = [
    {
      label: "Model không tồn tại → không retry",
      model: "gemini/model-khong-ton-tai",
    },
    {
      label: "Provider sập → retry 3 lần",
      model: "dead-provider/gemini-3.5-flash",
    },
  ];
  for (const { label, model } of attempts) {
    logQuestion(`[${label}] ${question}`);
    const result = await chatViaBifrost({
      model,
      fallbacks: [FALLBACK_MODEL],
      messages: [{ role: "user", content: question }],
    });
    logAnswer(
      result.answer,
      result.latencyMs,
      `model: ${result.servedModel} | fallback: ${result.usedFallback}`,
    );
  }
}

// =======================================================================
// PHẦN 6: LOAD BALANCING — CHIA TẢI GIỮA 2 MODEL
// =======================================================================

/**
 * Gửi 6 request có header `x-demo: load-balance` → chia 70% flash, 30% flash-lite.
 *
 * - Routing rule tự chọn model, bỏ qua model ghi trong request.
 * - Chia theo xác suất → 6 request không chắc ra đúng 4/2.
 * - Dùng khi:
 *   + Chuyển dần sang model mới: 95/5 → 50/50 → 0/100.
 *   + So sánh 2 model trên traffic thật (A/B test).
 *   + Đẩy nhiều request sang model rẻ hơn.
 */
async function loadBalancing() {
  logStep("Phần 6: Load balancing (70% flash / 30% flash-lite)");

  const questions = [
    "Kubernetes Ingress là gì?",
    "OSPF khác BGP thế nào?",
    "FPGA là gì?",
    "Kubernetes HPA là gì?",
    "VLAN trunk là gì?",
    "etcd trong Kubernetes làm gì?",
  ];

  const requestCountByModel = {};
  for (const [index, question] of questions.entries()) {
    const result = await chatViaBifrost(
      {
        model: PRIMARY_MODEL,
        messages: [{ role: "user", content: `${question} Trả lời 1 câu.` }],
      },
      { "x-demo": "load-balance" },
    );
    requestCountByModel[result.servedModel] =
      (requestCountByModel[result.servedModel] ?? 0) + 1;
    logInfo(
      `Request ${index + 1} → ${result.servedModel} (${result.latencyMs}ms): ${question}`,
    );
  }
  logInfo(`Tổng: ${JSON.stringify(requestCountByModel)}`);
}

// =======================================================================
// PHẦN 7: SESSION AFFINITY — CÙNG CUỘC HỘI THOẠI THÌ GIỮ NGUYÊN MODEL
// =======================================================================

/**
 * Session affinity: các request cùng header `x-bf-session-id` luôn đi tới model đã trả lời lượt đầu.
 *
 * - Vì sao cần: chia tải chọn model ngẫu nhiên mỗi request → 1 cuộc hội thoại có thể đổi model giữa chừng
 *   → giọng văn đổi, A/B test không biết model nào được khen, chê.
 * - Demo: 3 cuộc hội thoại, mỗi cuộc 3 lượt, qua luật `session-affinity-demo` (chia 50/50 Gemini và Groq):
 *   + Cuộc 1, 2: có session ID → mỗi cuộc giữ 1 model.
 *   + Cuộc 3: không có session ID → mỗi lượt chọn lại, có thể đổi model.
 * - Cần đủ 2 điều kiện, thiếu 1 là không giữ được model:
 *   + Luật có `fallbacks`. Luật của Phần 6 không có → không giữ được.
 *   + Request không nói rõ provider: ghi `gemini-3.5-flash`, không ghi `gemini/gemini-3.5-flash`.
 *     Nói rõ provider → Bifrost coi như app đã tự chọn model, không ghi nhớ.
 * - Model của session bị lỗi → vẫn fallback sang model khác, log ghi `fallback: true`.
 * - Session hết hạn sau 1 giờ. Đổi bằng header `x-bf-session-ttl`, VD `30m`.
 */
async function sessionAffinity() {
  logStep(
    "Phần 7: Session affinity — cùng cuộc hội thoại thì giữ nguyên model",
  );

  // 3 câu hỏi nối tiếp nhau trong 1 cuộc hội thoại
  const questions = [
    "LLM gateway là gì?",
    "Nêu 1 lợi ích chính.",
    "Khi nào không nên dùng?",
  ];

  const conversations = [
    { label: "Cuộc 1: có session ID", sessionId: `chat-1-${Date.now()}` },
    { label: "Cuộc 2: có session ID", sessionId: `chat-2-${Date.now()}` },
    { label: "Cuộc 3: không có session ID", sessionId: null },
  ];

  for (const { label, sessionId } of conversations) {
    logStep(label);
    // Lịch sử hội thoại. Model không tự nhớ nên mỗi lượt phải gửi lại cả lịch sử
    // → đổi model giữa chừng, model mới vẫn biết các lượt trước.
    const chatHistory = [];
    // Ghi lại model trả lời mỗi lượt → cuối cuộc xem có bị đổi model không
    const modelsPerTurn = [];
    for (const [turnIndex, question] of questions.entries()) {
      chatHistory.push({ role: "user", content: `${question} Trả lời 1 câu.` });
      const result = await chatViaBifrost(
        // Luật tự chọn Gemini hoặc Groq, bỏ qua model ghi ở đây.
        // Vẫn phải ghi model không có provider (điều kiện 2 ở trên).
        { model: "gemini-3.5-flash", messages: chatHistory },
        {
          "x-demo": "session-affinity",
          ...(sessionId && { "x-bf-session-id": sessionId }),
        },
      );
      // Lưu câu trả lời vào lịch sử → lượt sau gửi kèm
      chatHistory.push({ role: "assistant", content: result.answer });
      modelsPerTurn.push(result.servedModel);
      logInfo(`Lượt ${turnIndex + 1} — Hỏi: ${question}`);
      logAnswer(
        result.answer,
        result.latencyMs,
        `model: ${result.servedModel} | fallback: ${result.usedFallback}`,
      );
    }

    // Set bỏ model trùng → còn đúng 1 model nghĩa là cả cuộc không đổi model
    const isSameModel = new Set(modelsPerTurn).size === 1;
    logInfo(
      isSameModel
        ? `✅ Cả ${modelsPerTurn.length} lượt cùng model: ${modelsPerTurn[0]}`
        : `🔀 Đổi model giữa chừng: ${modelsPerTurn.join(" → ")}`,
    );
  }
}

// =======================================================================
// PHẦN 8: CACHE — CÂU HỎI GIỐNG HỆT HOẶC CÙNG Ý THÌ TRẢ KẾT QUẢ ĐÃ LƯU
// =======================================================================

/**
 * Gửi 3 request cùng cache key. Giữa các lần chờ 1s, vì Bifrost ghi cache sau khi trả response.
 *
 * - Lần 1: câu hỏi gốc → gọi Gemini, lưu cache.
 * - Lần 2: giống hệt → trúng cache.
 * - Lần 3: cùng ý, khác chữ → trúng nhờ semantic cache.
 *
 * Cache key (header `x-bf-cache-key`) = tên ngăn chứa cache:
 * - Không gửi cache key → không dùng cache.
 *   VD "Đơn hàng của tôi đâu?": mỗi người một đáp án → không gửi cache key.
 * - Khác cache key → không dùng chung cache.
 *   VD công ty A, B cùng hỏi "Chính sách nghỉ phép?" → đưa ID công ty vào key.
 * - Muốn mọi request dùng cache mà không gửi header: đặt `default_cache_key` trong config.
 */
async function caching() {
  logStep("Phần 8: Cache");

  const originalQuestion = "Định nghĩa Kubernetes ConfigMap trong 1 câu.";
  const rephrasedQuestion = "Kubernetes ConfigMap là gì? Trả lời 1 câu."; // cùng ý, khác chữ

  const requestBody = {
    model: PRIMARY_MODEL,
    messages: [{ role: "user", content: originalQuestion }],
    temperature: 0,
  };
  const cacheHeaders = { "x-bf-cache-key": "demo-tenant-1" }; // cache của công ty 1

  // Lần 1: câu hỏi gốc → lưu vào cache
  logQuestion(originalQuestion);
  const firstResult = await chatViaBifrost(requestBody, cacheHeaders);
  logAnswer(
    firstResult.answer,
    firstResult.latencyMs,
    `lần 1 | cache hit: ${firstResult.fromCache}`,
  );
  await sleep(1000);

  // Lần 2: câu hỏi giống hệt lần 1 → lấy từ cache
  const secondResult = await chatViaBifrost(requestBody, cacheHeaders);
  logAnswer(
    secondResult.answer,
    secondResult.latencyMs,
    `lần 2 | cache hit: ${secondResult.fromCache}`,
  );
  if (!secondResult.fromCache) {
    logInfo(
      "⚠️  Lần 2 không lấy từ cache: kiểm tra Redis đang chạy và plugin semantic_cache đã bật.",
    );
  }
  await sleep(1000);

  // Lần 3: cùng ý, khác chữ → chỉ trúng nhờ semantic cache
  const rephrasedBody = {
    ...requestBody,
    messages: [{ role: "user", content: rephrasedQuestion }],
  };
  logQuestion(rephrasedQuestion);
  const rephrasedResult = await chatViaBifrost(rephrasedBody, cacheHeaders);
  logAnswer(
    rephrasedResult.answer,
    rephrasedResult.latencyMs,
    `lần 3, hỏi khác chữ | cache hit: ${rephrasedResult.fromCache}`,
  );
  if (!rephrasedResult.fromCache) {
    logInfo(
      "⚠️  Lần 3 không lấy từ cache: 2 câu chưa đủ giống, thử hạ threshold trong bifrost-config.json.",
    );
  }
}

// =======================================================================
// PHẦN 9: LANGCHAIN — CHỈ ĐỔI CLIENT, CHAIN GIỮ NGUYÊN
// =======================================================================

/**
 * Chạy chain LangChain qua Bifrost: chỉ đổi model sang `ChatOpenAI` trỏ vào gateway.
 *
 * - Chain, agent, tool giữ nguyên.
 * - Endpoint riêng cho LangChain: `/langchain`.
 */
async function langchainIntegration() {
  logStep("Phần 9: LangChain");

  // Cách gọi trực tiếp: LangChain → Gemini.
  // const llm = new ChatGoogleGenerativeAI({
  //   apiKey: process.env.GEMINI_API_KEY,
  //   model: "gemini-3.5-flash",
  //   temperature: 0,
  // });

  // Cách gọi qua gateway: LangChain → Bifrost → Gemini.
  const llm = new ChatOpenAI({
    model: PRIMARY_MODEL,
    apiKey: "not-used",
    temperature: 0,
    // maxRetries: tắt retry của LangChain, để gateway retry
    maxRetries: 0,
    configuration: {
      baseURL: `${BIFROST_URL}/langchain`,
      defaultHeaders: { "x-bf-vk": process.env.BIFROST_VIRTUAL_KEY },
    },
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "Bạn là chuyên gia IT doanh nghiệp. Trả lời ngắn gọn."],
    ["human", "{question}"],
  ]);
  const chain = prompt.pipe(llm).pipe(new StringOutputParser());

  const question = "Pod affinity trong Kubernetes là gì?";
  logQuestion(question);
  const startedAt = Date.now();
  const answer = await chain.invoke({ question });
  logAnswer(answer, Date.now() - startedAt, "LCEL chain qua Bifrost");
}

// =======================================================================
// PHẦN 10: LANGGRAPH — CHỈ ĐỔI LLM, GRAPH GIỮ NGUYÊN
// =======================================================================

/**
 * Chạy agent trợ lý email (LangGraph) qua Bifrost, có 3 tool: xem lịch trống, đặt họp, gửi email.
 *
 * - Giống Phần 9: chỉ đổi LLM sang `ChatOpenAI` trỏ vào gateway. Node, edge, tool giữ nguyên.
 * - Graph: `START → agent → (có tool_calls) → tools → agent → ... → END`.
 * - Câu hỏi cần cả 3 tool theo thứ tự → agent lặp nhiều vòng.
 *   Mỗi vòng node `agent` gọi LLM 1 lần = 1 request qua gateway → log Bifrost thấy từng lần.
 */
async function langgraphIntegration() {
  logStep("Phần 10: LangGraph");

  const tools = [checkCalendarAvailability, scheduleMeeting, writeEmail];

  // bindTools: cho LLM biết có tool nào → LLM trả về `tool_calls` khi cần dùng
  const llm = new ChatOpenAI({
    model: PRIMARY_MODEL,
    apiKey: "not-used",
    temperature: 0,
    maxRetries: 0,
    configuration: {
      baseURL: `${BIFROST_URL}/langchain`,
      defaultHeaders: {
        "x-bf-vk": process.env.BIFROST_VIRTUAL_KEY,
        // x-bf-lh-feature: nhãn log, để lọc các call của graph này
        "x-bf-lh-feature": "langgraph-demo",
      },
    },
  }).bindTools(tools);

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state) => ({
      messages: [await llm.invoke(state.messages)],
    }))
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    // Có tool_calls → chạy tool, không có → kết thúc
    .addConditionalEdges(
      "agent",
      (state) => (state.messages.at(-1).tool_calls?.length ? "tools" : END),
      ["tools", END],
    )
    // Chạy tool xong quay lại LLM → tạo vòng lặp
    .addEdge("tools", "agent")
    .compile();

  const question =
    "Xem lịch trống thứ Ba, đặt họp 30 phút với alice@example.com về review RAG " +
    "vào khung giờ sớm nhất, rồi gửi email xác nhận cho alice.";
  logQuestion(question);
  const startedAt = Date.now();
  const result = await graph.invoke({ messages: [new HumanMessage(question)] });

  // In các tool agent đã gọi, theo thứ tự
  const toolCalls = result.messages.flatMap((m) => m.tool_calls ?? []);
  for (const call of toolCalls) {
    logInfo(`🔧 ${call.name}(${JSON.stringify(call.args)})`);
  }
  const llmCallCount = result.messages.filter((m) => m.type === "ai").length;
  logAnswer(
    result.messages.at(-1).content,
    Date.now() - startedAt,
    `${toolCalls.length} lần gọi tool, ${llmCallCount} lần gọi LLM qua Bifrost`,
  );
}

// =======================================================================
// PHẦN 11: STREAMING — NHẬN TỪNG ĐOẠN CÂU TRẢ LỜI
// =======================================================================

/**
 * `stream: true` → nhận từng đoạn câu trả lời ngay khi model sinh ra.
 *
 * - User thấy chữ hiện dần, không phải chờ cả câu trả lời.
 * - Request stream vẫn được ghi log.
 */
async function streaming() {
  logStep("Phần 11: Streaming");

  const question = "Giải thích LLM gateway làm gì, đúng 3 gạch đầu dòng.";
  logQuestion(question);

  const startedAt = Date.now();
  const stream = await bifrostClient.chat.completions.create({
    model: PRIMARY_MODEL,
    messages: [{ role: "user", content: question }],
    stream: true,
  });
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
  }
  console.log();
  logInfo(`⏱  ${Date.now() - startedAt}ms cho cả stream`);
}

// =======================================================================
// PHẦN 12: GỘP TẤT CẢ — CẤU HÌNH GẦN VỚI PRODUCTION
// =======================================================================

/**
 * Mỗi request gửi kèm fallback, cache key, metadata. Retry, timeout đặt sẵn ở gateway.
 *
 * - Câu 4: dave hỏi cùng ý câu 1 của alice → trúng cache, vì cùng cache key (cùng công ty).
 * - `x-bf-lh-user` chỉ là nhãn log, không chia cache theo user.
 */
async function productionSetup() {
  logStep(
    "Phần 12: Gộp tất cả (fallback + retry + timeout + cache + metadata)",
  );

  const userRequests = [
    {
      user: "alice",
      feature: "enterprise-rag",
      question: "Kubernetes RBAC là gì?",
    },
    {
      user: "bob",
      feature: "support-chat",
      question: "SR-IOV hoạt động thế nào?",
    },
    {
      user: "carol",
      feature: "docs-lookup",
      question: "BGP route reflector là gì?",
    },
    {
      user: "dave",
      feature: "enterprise-rag",
      question: "RBAC trong Kubernetes là gì?",
    },
  ];

  for (const { user, feature, question } of userRequests) {
    logQuestion(`[${user} | ${feature}] ${question}`);
    const result = await chatViaBifrost(
      {
        model: PRIMARY_MODEL,
        fallbacks: [FALLBACK_MODEL],
        messages: [{ role: "user", content: question }],
        temperature: 0,
      },
      {
        "x-bf-cache-key": "demo-tenant-1",
        "x-bf-lh-user": user,
        "x-bf-lh-feature": feature,
      },
    );
    logAnswer(
      result.answer,
      result.latencyMs,
      `model: ${result.servedModel} | fallback: ${result.usedFallback} | cache hit: ${result.fromCache}`,
    );
    await sleep(1000); // chờ cache ghi xong, để câu 4 lấy được từ cache
  }
}

// =======================================================================
// PHẦN 13: BUDGET — HẾT TIỀN THÌ CHẶN HOẶC CHUYỂN PROVIDER
// =======================================================================

/**
 * Gửi request bằng virtual key demo (BIFROST_BUDGET_VK): Gemini chỉ được $0.0001/giờ.
 *
 * - Bước 1: gửi Gemini 3 lần, không có `fallbacks`.
 *   1 request tốn khoảng $0.004 > budget $0.0001 → lần 1 qua nhưng đã vượt budget,
 *   lần 2–3 bị chặn: lỗi 402, type `budget_exceeded`.
 * - Bước 2: gửi Gemini kèm `fallbacks` Groq → gateway gửi sang Groq, app vẫn có câu trả lời.
 * - Budget reset sau 1 giờ. Chạy lại trong 1 giờ thì lần 1 cũng bị chặn.
 */
async function budgetLimits() {
  logStep("Phần 13: Budget — hết tiền thì chặn hoặc chuyển provider");

  if (!process.env.BIFROST_BUDGET_VK) {
    logInfo("Chưa có BIFROST_BUDGET_VK trong .env (xem mục 6 ở đầu file).");
    return;
  }
  // Gửi key demo thay key mặc định → request bị kiểm tra theo budget của key demo
  const budgetHeaders = { "x-bf-vk": process.env.BIFROST_BUDGET_VK };
  const question = "Kubernetes Service là gì? Trả lời 1 câu.";
  const messages = [{ role: "user", content: question }];

  // Bước 1: không có fallbacks → Gemini hết tiền thì bị chặn
  for (let attempt = 1; attempt <= 3; attempt++) {
    logQuestion(`[Không fallback, lần ${attempt}] ${question}`);
    try {
      const result = await chatViaBifrost(
        { model: BUDGET_GEMINI_MODEL, messages },
        budgetHeaders,
      );
      logAnswer(
        result.answer,
        result.latencyMs,
        `model: ${result.servedModel}`,
      );
    } catch (error) {
      logInfo(`❌ Bị chặn: ${error.message}`); // message đã có mã lỗi, VD "402 Budget exceeded..."
    }
  }

  // Bước 2: có fallbacks Groq → Gemini hết tiền thì chuyển sang Groq
  logQuestion(`[Có fallback Groq] ${question}`);
  try {
    const result = await chatViaBifrost(
      { model: BUDGET_GEMINI_MODEL, fallbacks: [GROQ_MODEL], messages },
      budgetHeaders,
    );
    logAnswer(
      result.answer,
      result.latencyMs,
      `model: ${result.servedModel} | fallback: ${result.usedFallback}`,
    );
  } catch (error) {
    logInfo(`❌ Vẫn bị chặn: ${error.message}`);
  }
}

// =======================================================================
// PHẦN 14: PROMPT Ở GATEWAY — APP CHỈ GỬI CÂU HỎI
// =======================================================================

/**
 * System prompt lưu ở gateway, app chỉ gửi câu hỏi. Gửi cùng 1 câu hỏi 3 lần:
 * không prompt, prompt v1, prompt v2.
 *
 * - `x-bf-prompt-id`: gateway thêm system prompt vào trước câu hỏi.
 * - `x-bf-prompt-version`: chọn version. Không gửi → dùng version mới nhất.
 * - Đổi prompt: commit version mới trên UI, không sửa code, không deploy lại app.
 * - Sai prompt ID hoặc version → không báo lỗi, chỉ là không có system prompt.
 *   Sai version cũng không tự dùng version mới nhất.
 */
async function gatewayPrompt() {
  logStep("Phần 14: Prompt ở gateway");

  const promptId = process.env.BIFROST_PROMPT_ID;
  if (!promptId) {
    logInfo("Chưa có BIFROST_PROMPT_ID trong .env (xem mục 6 ở đầu file).");
    return;
  }
  const question = "Kubernetes Pod là gì?";
  // Chỉ có câu hỏi, không có system message
  const body = {
    model: PRIMARY_MODEL,
    messages: [{ role: "user", content: question }],
  };

  const attempts = [
    { label: "Không có prompt", headers: {} },
    {
      label: "Prompt v1",
      headers: {
        "x-bf-prompt-id": promptId,
        "x-bf-prompt-version": "1",
      },
    },
    {
      label: "Prompt v2",
      headers: {
        "x-bf-prompt-id": promptId,
        "x-bf-prompt-version": "2",
      },
    },
  ];
  for (const { label, headers } of attempts) {
    logQuestion(`[${label}] ${question}`);
    const result = await chatViaBifrost(body, headers);
    logAnswer(result.answer, result.latencyMs);
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY || !process.env.BIFROST_VIRTUAL_KEY) {
    console.error(
      "Chưa có GEMINI_API_KEY hoặc BIFROST_VIRTUAL_KEY trong .env (xem mục 6 ở đầu file).",
    );
    process.exitCode = 1;
    return;
  }

  // Cơ bản
  await baseline(); // Phần 0
  await basicGatewayCall(); // Phần 1
  await metadataTagging(); // Phần 2

  // Fallback, retry, chia tải
  await requestFallback(); // Phần 3
  await configFallback(); // Phần 4
  await retryBeforeFallback(); // Phần 5
  await loadBalancing(); // Phần 6
  await sessionAffinity(); // Phần 7

  // Cache
  await caching(); // Phần 8

  // Tích hợp
  await langchainIntegration(); // Phần 9
  await langgraphIntegration(); // Phần 10
  await streaming(); // Phần 11

  // Gộp tất cả: chạy sau khi fallback và cache đã đúng
  await productionSetup(); // Phần 12

  // Quản lý ở gateway
  await budgetLimits(); // Phần 13: dùng virtual key demo riêng, không ảnh hưởng các phần trên
  await gatewayPrompt(); // Phần 14: cần tạo prompt trên UI trước (mục 6 ở đầu file)
}

main().catch((error) => {
  if (error instanceof OpenAI.APIConnectionError) {
    console.error(
      `Không kết nối được Bifrost ở ${BIFROST_URL}: bật gateway theo mục 6 ở đầu file.`,
    );
  } else {
    console.error(`${error.name}: ${error.message}`);
  }
  process.exitCode = 1;
});
