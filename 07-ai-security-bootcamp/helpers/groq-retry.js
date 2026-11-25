// =======================================================================
// AI SECURITY BOOTCAMP - GỌI LẠI KHI GROQ BÁO 429
//
// Dùng chung cho các bài eval có judge chạy trên Groq (04-evals/05, 06).
//
// Groq giới hạn 2 kiểu, cả 2 đều báo lỗi 429:
//   - Quá token/phút  → chờ một lúc rồi gọi lại là được.
//   - Hết token/ngày  → gọi lại cũng lỗi, phải đợi hôm sau.
// =======================================================================

const { logInfo } = require("./log");

const MAX_CALLS = 3;
const WAIT_MS = 20_000;

/** Hết token/ngày: message của Groq có chữ "tokens per day". */
function isDailyLimit(error) {
  return String(error?.message).includes("tokens per day");
}

/** Quá token/phút: lỗi 429 nhưng không phải hết token/ngày. */
function isPerMinuteLimit(error) {
  // Ưu tiên mã lỗi `status`; lỗi bị DeepEval bọc lại có thể mất `status` → xem thêm message.
  const is429 = error?.status === 429 || String(error?.message).includes("429");
  return is429 && !isDailyLimit(error);
}

/**
 * Gọi `fn`. Quá token/phút → chờ 20 giây rồi gọi lại, tối đa 3 lần gọi (tức 2 lần thử lại).
 * Lỗi khác, hoặc hết token/ngày → ném lỗi luôn.
 */
async function withRetry(fn) {
  for (let call = 1; ; call++) {
    try {
      return await fn();
    } catch (error) {
      if (!isPerMinuteLimit(error) || call === MAX_CALLS) throw error;
      logInfo(
        `(Groq báo 429 — vượt giới hạn token/phút, chờ 20 giây rồi gọi lại lần ${call + 1}/${MAX_CALLS})`,
      );
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    }
  }
}

module.exports = { withRetry, isDailyLimit };
