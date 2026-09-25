// =======================================================================
// HƯỚNG DẪN: PROMPT TEMPLATE & SINH SQL VỚI OLLAMA
// =======================================================================
//
// 1. CHAT MODEL & SPECIAL TOKEN:
//    - Chat model không nhận "danh sách tin nhắn", nó chỉ đọc một chuỗi chữ dài.
//    - Các vai (system, user, assistant) được phân tách bằng "special token" (ký hiệu riêng, VD: <|eot_id|>).
//    - Template = Quy ước đặt token của từng họ model (Llama 3 khác, Qwen khác).
//    - Prompt luôn kết thúc bằng phần assistant để trống để model biết "đến lượt mình trả lời".
//
// 2. CÁCH GỌI MODEL QUA OLLAMA:
//    - Sử dụng Ollama chạy model `qwen3` trực tiếp trên máy.
//    - `raw: true`: Tắt template tự động của Ollama để ta chủ động tự viết/kiểm soát template.
//
// 3. RỦI RO KHI YÊU CẦU MODEL VIẾT SQL:
//    - Câu lệnh càng phức tạp (VD: tính p95 - giá trị mà 95% số dòng nhỏ hơn) thì model nhỏ càng dễ sai.
//    - Mỗi loại CSDL có cú pháp khác nhau -> model rất hay bịa cú pháp (đọc thấy hợp lý nhưng chạy thật mới báo lỗi).
// =======================================================================

require("dotenv").config();
const { Ollama } = require("ollama");

const MODEL = "qwen3:latest";

// Dùng 127.0.0.1 thay vì localhost: Tránh lỗi phân giải IPv6 (::1) trên Node 18+ gây mất kết nối Ollama
const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
});

/** In tiêu đề phân cách các phần trong console */
function section(title) {
  const line = "=".repeat(60);
  console.log(`\n\n${line}\n ${title}\n${line}`);
}

/**
 * Gửi chuỗi prompt trực tiếp cho Ollama (không dùng template tự động).
 * @param {string} prompt - Chuỗi prompt đã được gắn template thủ công
 * @param {number} maxNewTokens - Số token tối đa model được phép sinh ra
 */
async function generate(prompt, maxNewTokens = 200) {
  const res = await ollama.generate({
    model: MODEL,
    prompt,
    raw: true, // Tắt template mặc định của Ollama, bắt buộc tự xử lý template trong prompt
    options: { num_predict: maxNewTokens }, // Ollama dùng tham số num_predict để giới hạn số token trả về
  });
  return res.response.trim();
}

// =======================================================================
// 1. TEMPLATE LLAMA 3 (3 CÁCH VIẾT KHÁC NHAU CHO CÙNG 1 KẾT QUẢ)
// =======================================================================
// - <|begin_of_text|>: Đánh dấu mở đầu toàn bộ cuộc hội thoại
// - <|start_header_id|>ROLE<|end_header_id|>\n\n: Gắn nhãn người nói (system / user / assistant)
// - <|eot_id|>: Đánh dấu kết thúc một lượt nói (End of Turn)

// Cách 1: Viết gộp toàn bộ trong một template string nhiều dòng
const prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>

You are a helpful assistant.<|eot_id|><|start_header_id|>user<|end_header_id|>

Please write a birthday card for my good friend Andrew<|eot_id|><|start_header_id|>assistant<|end_header_id|>

`;

// Cách 2: Nối các chuỗi nhỏ (dễ chú thích chi tiết từng token)
const prompt2 =
  "<|begin_of_text|>" + // Mở đầu hội thoại
  "<|start_header_id|>system<|end_header_id|>\n\n" + // Khai báo vai trò hệ thống
  "You are a helpful assistant." + // Nội dung system prompt
  "<|eot_id|>" + // Hết lượt hệ thống
  "<|start_header_id|>user<|end_header_id|>\n\n" + // Khai báo người dùng
  "Please write a birthday card for my good friend Andrew" +
  "<|eot_id|>" + // Hết lượt người dùng
  "<|start_header_id|>assistant<|end_header_id|>\n\n"; // Mở lượt assistant, để trống cho model viết tiếp

/**
 * Cách 3: Hàm tự động sinh template Llama 3 từ nội dung truyền vào.
 * (Bỏ qua phần system nếu không truyền vào).
 */
function makeLlama3Prompt(user, system = "") {
  const systemBlock = system
    ? `<|start_header_id|>system<|end_header_id|>\n\n${system}<|eot_id|>`
    : "";
  return (
    `<|begin_of_text|>${systemBlock}` +
    `<|start_header_id|>user<|end_header_id|>\n\n${user}<|eot_id|>` +
    `<|start_header_id|>assistant<|end_header_id|>\n\n`
  );
}

// =======================================================================
// 2. TEMPLATE QWEN3 (CHATML) — DÙNG CHÍNH THỨC CHO MODEL THẬT
// =======================================================================
// - <|im_start|>ROLE\n ... <|im_end|>\n: Khung chứa một lượt hội thoại của ROLE (im = interaction/message).
// - <think>\n\n</think>: Thẻ tư duy của Qwen3.
//   Mặc định model sẽ tự "suy nghĩ" rất kỹ trước khi trả lời.
//   Việc để sẵn thẻ trống này giúp đánh lừa model là "đã nghĩ xong",
//   giúp model trả lời nhanh hơn nhưng đôi khi dễ làm giảm độ chính xác.

/** Hàm tạo prompt chuẩn theo định dạng ChatML của Qwen3 */
function makeQwenPrompt(user, system = "") {
  const systemBlock = system ? `<|im_start|>system\n${system}<|im_end|>\n` : "";
  return (
    systemBlock +
    `<|im_start|>user\n${user}<|im_end|>\n` +
    `<|im_start|>assistant\n<think>\n\n</think>\n\n`
  );
}

async function main() {
  section("1. Test Template Llama 3 — So sánh 3 cách viết");
  const prompt3 = makeLlama3Prompt(
    "Please write a birthday card for my good friend Andrew",
    "You are a helpful assistant.",
  );
  console.log(prompt3);
  console.log("prompt === prompt2:", prompt === prompt2); // true
  console.log("prompt === prompt3:", prompt === prompt3); // true

  section("2. Gửi nhầm Template Llama 3 cho Qwen3");
  // Qwen3 vẫn hiểu được ý nhờ khả năng suy luận ngữ cảnh tổng quát,
  // nhưng thực tế luôn phải dùng đúng template riêng của từng họ model.
  console.log(await generate(prompt, 100));

  section("3. Dùng đúng Template QWEN3 — Viết thiệp sinh nhật");
  const birthdayPrompt = makeQwenPrompt(
    "Please write a birthday card for my good friend Andrew",
    "You are a helpful assistant.",
  );
  console.log(birthdayPrompt);
  console.log(await generate(birthdayPrompt));

  section("4. Không có System Prompt — Kể chuyện cười");
  const jokePrompt = makeQwenPrompt("Tell me a joke about birthday cake");
  console.log(jokePrompt);
  console.log(await generate(jokePrompt));

  // =======================================================================
  // 5. SINH SQL — ĐỘ KHÓ TĂNG DẦN
  // =======================================================================
  // - Câu 1 & 2: Thao tác cơ bản (đếm dòng, tính trung bình) -> Model nào cũng làm đúng.
  // - Câu 3 & 4: Tính giá trị p95 -> Đòi hỏi hàm phức tạp, model dễ lẫn lộn giữa các hệ CSDL.
  // - Riêng câu 4 (SQLite): SQLite thực tế KHÔNG hỗ trợ hàm chuẩn `PERCENTILE_CONT ... WITHIN GROUP`,
  //   nhưng model thường vẫn tự tin bịa ra cú pháp này. Nhìn có vẻ đúng nhưng chạy thật sẽ lỗi.
  const sqlQuestions = [
    "Given an arbitrary table named `sql_table`, write a query to return how many rows are in the table.",
    "Given an arbitrary table named `sql_table`, help me calculate the average `height` where `age` is above 20.",
    "Given an arbitrary table named `sql_table`, Can you calculate the p95 `height` where the `age` is above 20?",
    "Given an arbitrary table named `sql_table`, Can you calculate the p95 `height` where the `age` is above 20? Use sqlite.",
  ];

  for (const [i, question] of sqlQuestions.entries()) {
    section(`5.${i + 1} SQL: ${question}`);
    console.log(await generate(makeQwenPrompt(question)));
  }
}

main().catch(console.error);
