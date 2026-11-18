require("../../_shared/polyfill");

// =======================================================================
// LLM GATEWAY 3: BIFROST — CACHE VÀ GỘP TẤT CẢ
//
// Mục đích: câu hỏi giống hệt hoặc cùng ý thì gateway trả kết quả đã lưu, không gọi model.
// Sau đó gộp fallback, retry, timeout, cache, metadata vào cùng 1 request, gần với production.
//
// 1. Config dùng trong file này (bifrost-config.json):
//    - vector_store + plugins.semantic_cache: bật cache, lưu trong Redis.
//      + Semantic cache: model embedding đổi câu hỏi thành vector (dãy số thể hiện ý nghĩa)
//        → câu khác chữ nhưng cùng ý vẫn trúng cache.
//      + threshold: độ giống tối thiểu (0 → 1) để trúng cache.
//        Thấp quá → trả nhầm đáp án. Cao quá → ít trúng.
//      + Muốn chỉ cache câu giống hệt: đặt `dimension: 1`, bỏ `provider` và `embedding_model`.
//    - Retry, timeout, routing: giải thích trong 02-retry-fallback-routing.js.
//
// 2. Luồng file:
//    - Phần 1: Cache — câu giống hệt hoặc cùng ý thì trả kết quả đã lưu
//    - Phần 2: Gộp tất cả — fallback + retry + timeout + cache + metadata trong cùng 1 request
//
// 3. Chuẩn bị: bật gateway theo phần Chuẩn bị trong 01-gateway-basics.js
//    (docker-compose.yml đã bật sẵn Redis cho cache).
//
// Chạy lệnh:
//    node 07-ai-security-bootcamp/03-llm-gateway/03-cache-and-full-setup.js
// =======================================================================

require("dotenv").config();

const { logInfo, logQuestion, logStep } = require("../helpers/log");

const {
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  sleep,
  chatViaBifrost,
  logAnswer,
  runLesson,
} = require("./helpers/bifrost");

// =======================================================================
// PHẦN 1: CACHE — CÂU HỎI GIỐNG HỆT HOẶC CÙNG Ý THÌ TRẢ KẾT QUẢ ĐÃ LƯU
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
  logStep("Phần 1: Cache");

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
// PHẦN 2: GỘP TẤT CẢ — CẤU HÌNH GẦN VỚI PRODUCTION
// =======================================================================

/**
 * Mỗi request gửi kèm fallback, cache key, metadata. Retry, timeout đặt sẵn ở gateway.
 *
 * - Câu 4: dave hỏi cùng ý câu 1 của alice → trúng cache, vì cùng cache key (cùng công ty).
 * - `x-bf-lh-user` chỉ là nhãn log, không chia cache theo user.
 */
async function productionSetup() {
  logStep(
    "Phần 2: Gộp tất cả (fallback + retry + timeout + cache + metadata)",
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

async function main() {
  await caching(); // Phần 1
  await productionSetup(); // Phần 2: chạy sau khi cache đã chạy đúng ở Phần 1
}

runLesson(main);
