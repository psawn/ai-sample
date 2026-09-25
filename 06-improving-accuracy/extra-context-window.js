// =======================================================================
// BÀI PHỤ: CONTEXT WINDOW — NHÉT CÀNG NHIỀU VÀO PROMPT CÀNG TỐT?
// =======================================================================
// Nên đọc trước: 00-llm-fundamentals/01-tokenization.js (token là gì)
//
// Context window = độ dài tối đa (tính bằng token) model đọc được trong 1 lần gọi.
// Model mới đọc được hàng trăm nghìn token -> dễ nghĩ cứ đưa hết schema DB vào prompt.
// File này đo xem làm vậy thì mất gì:
// - Tiền: tính theo token -> prompt dài gấp bao nhiêu lần, tiền tăng bấy nhiêu lần
// - Tốc độ: prompt dài có làm model trả lời chậm hơn không?
// - Độ chính xác: model có còn tìm đúng thông tin không, nhất là khi thông tin nằm
//   ở GIỮA prompt dài ("lost in the middle": model đời cũ hay bỏ sót đoạn giữa)
//
// ----- THÍ NGHIỆM "MÒ KIM ĐÁY BỂ" (needle in a haystack) -----
// - Đáy bể: N bảng giả không liên quan + 3 bảng "gây nhiễu" có tên gần giống đáp án
// - Cây kim: bảng loyalty_points_ledger, bảng duy nhất lưu điểm thưởng tích lũy
// - Hỏi: "Bảng nào lưu điểm thưởng tích lũy?" rồi đo đúng/sai, số token, thời gian
//
// ----- KẾT LUẬN -----
// - Model mới tìm 1 bảng có tên rõ ràng rất tốt, dù kim ở đầu / giữa / cuối 1000 bảng.
// - Thời gian gần như không đổi, nhưng token (= tiền) tăng theo số bảng.
//   -> Lý do chính để chỉ gửi bảng liên quan (schema retrieval) là TIỀN.
// - Câu hỏi khó hơn (JOIN nhiều bảng, tên bảng mơ hồ) thì chưa chắc -> phải đo bằng bộ đề
//   (xem 04-evaluation.js, Level 6 trong plans/text-to-sql-nestjs.md).
//
// ----- CÁCH CHẠY -----
// - Cần: GEMINI_API_KEY trong .env.
// =======================================================================

require("dotenv").config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL = "gemini-3.5-flash-lite";
const ANSWER = "loyalty_points_ledger"; // Đáp án đúng, dùng để chấm
const QUESTION =
  "Bảng nào lưu số điểm thưởng mà mỗi khách hàng đã tích lũy? Chỉ trả lời đúng tên bảng.";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// temperature 0: bớt ngẫu nhiên để so sánh giữa các lần thử công bằng hơn
const model = genAI.getGenerativeModel({ model: MODEL, generationConfig: { temperature: 0 } });

/** In tiêu đề từng phần */
function section(title) {
  console.log(`\n========== ${title} ==========`);
}

// Bảng gây nhiễu: tên có chữ "loyalty"/"points"/"reward" giống đáp án nhưng lưu thứ khác
const DISTRACTORS = [
  "CREATE TABLE loyalty_tiers (id INT, name TEXT, min_points INT); -- Các hạng thành viên",
  "CREATE TABLE reward_catalog (id INT, title TEXT, points_cost INT); -- Quà đổi được bằng điểm",
  "CREATE TABLE points_of_sale (id INT, store_id INT, terminal_code TEXT); -- Máy bán hàng tại quầy",
];

// Cây kim: bảng đáp án
const NEEDLE =
  "CREATE TABLE loyalty_points_ledger (id INT, customer_id INT, delta INT, reason TEXT, created_at TIMESTAMPTZ); " +
  "-- Sổ cái cộng/trừ điểm thưởng của khách hàng";

// Nguyên liệu để ghép tên bảng giả, VD "billing_events_9"
const DOMAINS = ["hr", "billing", "inventory", "shipping", "marketing", "support", "audit", "finance"];
const ENTITIES = ["records", "events", "snapshots", "settings", "logs", "requests", "mappings", "reports"];

/** Tạo 1 bảng giả không liên quan tới câu hỏi. Cùng i luôn ra cùng 1 bảng (chạy lại không đổi) */
function fillerTable(i) {
  const name = `${DOMAINS[i % DOMAINS.length]}_${ENTITIES[Math.floor(i / DOMAINS.length) % ENTITIES.length]}_${i}`;
  return `CREATE TABLE ${name} (id INT, ref_code TEXT, amount NUMERIC, status TEXT, created_at TIMESTAMPTZ);`;
}

/**
 * Dựng schema gồm đúng tableCount bảng: bảng giả + bảng gây nhiễu + cây kim.
 * position = chỗ đặt cây kim: 0 = đầu, 0.5 = giữa, 1 = cuối.
 */
function buildSchema(tableCount, position) {
  const tables = Array.from({ length: tableCount - DISTRACTORS.length - 1 }, (_, i) => fillerTable(i));
  // Chèn 3 bảng gây nhiễu cách đều nhau (ở 1/4, 2/4, 3/4 schema)
  DISTRACTORS.forEach((d, k) => {
    tables.splice(Math.floor(((k + 1) * tables.length) / (DISTRACTORS.length + 1)), 0, d);
  });
  tables.splice(Math.round(position * tables.length), 0, NEEDLE); // Chèn cây kim
  return tables.join("\n");
}

/** Hỏi model trên 1 schema, trả về 1 dòng kết quả cho console.table */
async function runTrial(tableCount, position) {
  const prompt = `Schema của database:\n${buildSchema(tableCount, position)}\n\n${QUESTION}`;
  const start = Date.now();
  const result = await model.generateContent(prompt);
  const answer = result.response.text().trim().replace(/`/g, ""); // Bỏ dấu ` nếu model bọc tên bảng
  return {
    "Số bảng": tableCount,
    "Vị trí kim": { 0: "đầu", 0.5: "giữa", 1: "cuối" }[position],
    "Prompt token": result.response.usageMetadata.promptTokenCount, // Số token Gemini thật sự tính tiền
    "Thời gian (ms)": Date.now() - start,
    "Trả lời": answer,
    Đúng: answer === ANSWER ? "✅" : "❌",
  };
}

async function main() {
  console.log(`Câu hỏi: ${QUESTION}\nĐáp án: ${ANSWER}`);

  section("1. Số bảng tăng dần (kim ở giữa)");
  const bySize = [];
  for (const tableCount of [20, 200, 1000]) {
    bySize.push(await runTrial(tableCount, 0.5)); // Chạy lần lượt (không song song) để đo thời gian cho chuẩn
  }
  console.table(bySize);

  section("2. Cùng 1000 bảng, đổi vị trí kim");
  const byPosition = [];
  for (const position of [0, 1]) {
    byPosition.push(await runTrial(1000, position));
  }
  console.table(byPosition);
}

main().catch(console.error);
