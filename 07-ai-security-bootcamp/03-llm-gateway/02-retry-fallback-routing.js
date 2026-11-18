require("../../_shared/polyfill");

// =======================================================================
// LLM GATEWAY 2: BIFROST — RETRY, FALLBACK, CHIA TẢI
//
// Mục đích: model lỗi thì gateway tự retry, chuyển sang model dự phòng (fallback),
// chia request cho nhiều model, giữ nguyên model trong 1 cuộc hội thoại.
//
// 1. Retry và fallback (Phần 1–3)
//    - Retry: gửi lại cho cùng model. Fallback: chuyển sang model dự phòng.
//    - Model lỗi thì gateway xử lý theo loại lỗi:
//      + Lỗi tạm thời (mất mạng, provider sập, quá tải) → retry tối đa 3 lần → vẫn lỗi → fallback.
//        Mỗi lần retry chờ lâu hơn lần trước (0.5s → 1s → 2s).
//      + Lỗi do request (sai tên model, sai tham số) → fallback luôn, vì gửi lại vẫn sai.
//      + Quá 30s chưa trả lời (timeout) → fallback luôn, để user không phải chờ thêm 30s nữa.
//      + Model dự phòng lỗi → cũng xử lý y như trên.
//    - Fallback khai báo được ở 2 chỗ:
//      + Trong request (Phần 1): app gửi `fallbacks` trong body.
//        → Mỗi request chọn được dự phòng riêng.
//        → Nhưng request nào quên gửi là không có dự phòng. Đổi model dự phòng phải sửa code.
//      + Trong config (Phần 2): khai báo `fallbacks` trong routing rule.
//        → App không cần gửi `fallbacks` trong body. Đổi model dự phòng chỉ cần sửa config.
//        → Nhưng áp chung cho mọi request khớp luật.
//    - Retry làm user chờ lâu hơn (Phần 3):
//      → Provider sập → chờ hết 3 lần retry (thêm khoảng 3s) rồi mới fallback.
//      → `max_retries` càng lớn, user chờ càng lâu.
//
// 2. Gateway chọn provider thế nào?
//    - Tên model có provider (VD `gemini/gemini-3.5-flash`) → luôn gọi đúng provider đó, bỏ qua `weight`.
//      Các bài đều ghi rõ provider, trừ Phần 5.
//    - Không ghi provider (VD `gemini-3.5-flash`) → vẫn chạy, gateway tự chọn theo `weight`
//      trong `provider_configs` của virtual key.
//      + VD OpenAI và Azure đều có `gpt-4o`, cùng `weight: 1` → mỗi bên ~50%.
//      + `weight: 0` → không bao giờ được tự chọn, chỉ gọi khi request nói rõ provider đó.
//      + Đổi `weight` là có thể bị gửi sang provider khác → chỉ bỏ provider khi cần, như Phần 5.
//    - `vk-main`: Gemini `weight: 1`, Groq và dead-provider `weight: 0`
//      → request không nói rõ provider thì luôn chọn Gemini.
//    - Chia giữa 2 model khác nhau (VD Gemini 70%, Groq 30%) → dùng routing rule (Phần 4).
//
// 3. Config dùng trong file này (bifrost-config.json):
//    - providers.dead-provider: provider giả, trỏ tới cổng không có gì chạy (localhost:9999)
//      → luôn không kết nối được. Dùng ở Phần 3 để giả lập provider sập.
//      Khởi động gateway sẽ thấy warning `failed to list models` của provider này, không sao.
//    - network_config: timeout 30s, retry tối đa 3 lần (xem mục 1).
//      Gemini và dead-provider đặt giống nhau.
//    - governance.routing_rules: luật chọn model.
//      Mỗi luật chỉ áp cho request có header `x-demo` tương ứng:
//      + `config-fallback-demo` (Phần 2): model chính lỗi → chuyển sang model dự phòng khai báo trong luật.
//      + `load-balance-demo` (Phần 4): chia 70/30 cho 2 model.
//      + `session-affinity-demo` (Phần 5): chia 50/50 cho Gemini và Groq. Có `fallbacks` để session giữ được model.
//      + Các luật cùng scope phải khác `priority`. Trùng → Bifrost bỏ qua luật, chỉ ghi warning trong log.
//
// 4. Luồng file:
//    - Phần 1: Fallback trong request — app gửi `fallbacks`
//    - Phần 2: Fallback trong config — app không cần gửi `fallbacks`
//    - Phần 3: Provider sập — retry hết lượt rồi mới fallback
//    - Phần 4: Load balancing — chia 70/30 cho 2 model
//    - Phần 5: Session affinity — cùng cuộc hội thoại thì giữ nguyên model
//
// 5. Chuẩn bị: bật gateway theo phần Chuẩn bị trong 01-gateway-basics.js.
//
// Chạy lệnh:
//    node 07-ai-security-bootcamp/03-llm-gateway/02-retry-fallback-routing.js
// =======================================================================

require("dotenv").config();

const { logInfo, logQuestion, logStep } = require("../helpers/log");

const {
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  chatViaBifrost,
  logAnswer,
  runLesson,
} = require("./helpers/bifrost");

// =======================================================================
// PHẦN 1: FALLBACK TRONG REQUEST — MODEL CHÍNH LỖI THÌ CHUYỂN SANG MODEL DỰ PHÒNG
// =======================================================================

/**
 * Fallback khai báo trong request: app gửi `fallbacks` (danh sách model dự phòng) trong body.
 * Model chính lỗi → gateway thử lần lượt từng model dự phòng.
 *
 * - Lần 1: model chính chạy bình thường → không dùng dự phòng.
 * - Lần 2: model không tồn tại → lỗi → chuyển sang dự phòng. App không thấy lỗi.
 */
async function requestFallback() {
  logStep("Phần 1: Fallback trong request");

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
// PHẦN 2: FALLBACK TRONG CONFIG — APP KHÔNG CẦN GỬI `fallbacks`
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
  logStep("Phần 2: Fallback trong config");

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
// PHẦN 3: PROVIDER SẬP — RETRY HẾT LƯỢT RỒI MỚI FALLBACK
// =======================================================================

/**
 * So thời gian chờ fallback của 2 loại lỗi. Cả 2 lần đều gửi `fallbacks` trong body (giống Phần 1).
 *
 * - Lần 1: model không tồn tại → lỗi do request, không retry → fallback ngay.
 * - Lần 2: `dead-provider` (provider giả, luôn không kết nối được) → retry 3 lần → rồi mới fallback.
 * - Lần 2 chậm hơn khoảng 3s = thời gian chờ giữa các lần retry (0.5s + 1s + 2s, cộng chút ngẫu nhiên).
 */
async function retryBeforeFallback() {
  logStep("Phần 3: Provider sập — retry hết lượt rồi mới fallback");

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
// PHẦN 4: LOAD BALANCING — CHIA TẢI GIỮA 2 MODEL
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
  logStep("Phần 4: Load balancing (70% flash / 30% flash-lite)");

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
// PHẦN 5: SESSION AFFINITY — CÙNG CUỘC HỘI THOẠI THÌ GIỮ NGUYÊN MODEL
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
 *   + Luật có `fallbacks`. Luật của Phần 4 không có → không giữ được.
 *   + Request không nói rõ provider: ghi `gemini-3.5-flash`, không ghi `gemini/gemini-3.5-flash`.
 *     Nói rõ provider → Bifrost coi như app đã tự chọn model, không ghi nhớ.
 * - Model của session bị lỗi → vẫn fallback sang model khác, log ghi `fallback: true`.
 * - Session hết hạn sau 1 giờ. Đổi bằng header `x-bf-session-ttl`, VD `30m`.
 */
async function sessionAffinity() {
  logStep(
    "Phần 5: Session affinity — cùng cuộc hội thoại thì giữ nguyên model",
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

async function main() {
  await requestFallback(); // Phần 1
  await configFallback(); // Phần 2
  await retryBeforeFallback(); // Phần 3
  await loadBalancing(); // Phần 4
  await sessionAffinity(); // Phần 5
}

runLesson(main);
