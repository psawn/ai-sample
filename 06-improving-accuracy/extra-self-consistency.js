// =======================================================================
// BÀI PHỤ: SELF-CONSISTENCY — ĐO XEM MODEL CÓ CHẮC KHÔNG
// =======================================================================
// Nên đọc trước: 01-llama3-basics.js (thấy model bịa),
//   00-llm-fundamentals/02-sampling.js (vì sao hỏi cùng 1 câu mà mỗi lần ra 1 khác)
//
// ----- VẤN ĐỀ -----
// Model bịa mà giọng vẫn rất tự tin -> đọc câu trả lời không biết câu nào
// model biết thật, câu nào đang đoán.
//
// ----- CÁCH ĐO -----
// Hỏi lại cùng 1 câu nhiều lần (temperature > 0 để có ngẫu nhiên):
// - Model biết thật -> lần nào cũng trả lời giống nhau
// - Model đang đoán -> mỗi lần 1 kiểu
// "Đồng thuận" = câu trả lời phổ biến nhất xuất hiện mấy lần / tổng số lần.
//   VD 7/7 = rất nhất quán, 3/7 = đang đoán.
// "Majority vote" (bỏ phiếu theo số đông) = lấy câu phổ biến nhất làm kết quả,
//   thường đúng hơn chỉ hỏi 1 lần.
//
// ----- GIỚI HẠN -----
// - Tốn gấp N lần tiền và thời gian -> chỉ dùng cho câu quan trọng.
// - Đồng thuận cao CHƯA chắc đúng: model có thể sai giống nhau mọi lần (xem câu 3).
// - Logprobs (xác suất model gán cho từng token) đo độ chắc trực tiếp hơn,
//   nhưng Gemini hiện chưa hỗ trợ (báo "Logprobs is not enabled").
//
// ----- CÁCH CHẠY -----
// - Cần: GEMINI_API_KEY trong .env.
// =======================================================================

require("dotenv").config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL = "gemini-3.5-flash-lite";
const RUNS = 7; // Số lần hỏi lại mỗi câu

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: MODEL,
  generationConfig: { temperature: 1 }, // Phải có ngẫu nhiên thì mới thấy model chắc hay đang đoán
});

/** In tiêu đề từng phần */
function section(title) {
  console.log(`\n========== ${title} ==========`);
}

/**
 * Hỏi cùng 1 câu RUNS lần, đếm mỗi câu trả lời xuất hiện bao nhiêu lần.
 * Trả về mảng [câu trả lời, số lần], xếp từ nhiều đến ít.
 */
async function askMany(question) {
  const results = await Promise.all(
    Array.from({ length: RUNS }, () => model.generateContent(question)),
  );
  const counts = {};
  for (const r of results) {
    // Bỏ dấu chấm cuối + viết thường để "Có." và "có" tính là 1 câu
    const answer = r.response.text().trim().replace(/\.$/, "").toLowerCase();
    counts[answer] = (counts[answer] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/** In các câu trả lời kèm số lần, rồi in câu thắng phiếu và mức đồng thuận */
function report(question, ranked) {
  console.log(`Câu hỏi: ${question}`);
  for (const [answer, count] of ranked) console.log(`  ${count}x  ${answer}`);
  const [top, topCount] = ranked[0];
  console.log(`  -> Majority vote: "${top}" · đồng thuận ${topCount}/${RUNS}`);
}

async function main() {
  const questions = [
    // Câu 1 — kiến thức phổ biến -> đồng thuận cao và đúng ("Có")
    "PostgreSQL có hàm PERCENTILE_CONT không? Chỉ trả lời Có hoặc Không.",
    // Câu 2 — câu model hay bịa (xem 01-llama3-basics.js) -> mỗi lần ra 1 phiên bản khác
    //   = lộ ra là đang đoán (đáp án đúng: 3.47, nên tự kiểm chứng)
    "SQLite hỗ trợ hàm percentile_cont từ phiên bản nào? Chỉ trả lời số phiên bản, không giải thích.",
    // Câu 3 — MySQL KHÔNG có hàm này, nhưng model nhầm với DB khác và lần nào cũng trả lời "Có"
    //   -> sai mà vẫn nhất quán, cách đo này không bắt được
    "MySQL 8.0 có hàm PERCENTILE_CONT không? Chỉ trả lời Có hoặc Không.",
  ];

  for (const [i, question] of questions.entries()) {
    section(`${i + 1}`);
    report(question, await askMany(question));
  }
  // Áp dụng cho Text-to-SQL: cho model viết SQL N lần, CHẠY từng câu rồi so kết quả.
  // - Kết quả lệch nhau -> báo "không chắc" hoặc hỏi lại người dùng
  // - Kết quả trùng nhau vẫn có thể sai (như câu 3) -> vẫn cần bộ đề có đáp án (xem 04-evaluation.js)
}

main().catch(console.error);
