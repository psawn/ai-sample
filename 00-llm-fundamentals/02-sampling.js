// =======================================================================
// LLM FUNDAMENTALS 2: SAMPLING — VÌ SAO CÙNG CÂU HỎI MÀ MỖI LẦN 1 KHÁC
//
// Model viết câu trả lời như thế nào?
// - Model viết từng token một. Mỗi bước, nó chấm điểm xác suất cho MỌI token
//   có thể viết tiếp. VD sau "Quán cà phê Mây ..." có thể là:
//     " Trắng" 40% · " Lang" 30% · " Trôi" 20% · token khác 10%
// - Rồi nó "bốc thăm" 1 token theo các xác suất đó -> vì bốc thăm nên mỗi lần ra khác.
//
// Các núm chỉnh việc bốc thăm:
// - temperature: độ "liều".
//     0   = luôn chọn token xác suất cao nhất (" Trắng") -> ổn định, nhàm
//     cao = các lựa chọn gần ngang nhau, token ít khả năng cũng hay được chọn
//           -> đa dạng nhưng dễ nói linh tinh. Gemini cho tối đa 2.
// - topK: chỉ bốc trong K token cao điểm nhất. topK = 1 -> chỉ còn 1 lựa chọn.
// - topP: chỉ bốc trong nhóm token đứng đầu có tổng xác suất đạt P (VD 0.9 = 90%).
//
// Kết quả đo thật (28/10/2026, gemini-3.5-flash-lite):
// - temperature 0, và cả topK 1, VẪN ra câu khác nhau giữa các lần gọi.
// - Lý thuyết nói phải giống hệt, nhưng API không cam kết điều đó. Nghi do phía
//   server Google (gộp nhiều request chạy chung, sai số làm tròn số thực).
//
// Áp dụng:
// - Eval / Text-to-SQL: đặt temperature 0 để bớt dao động, NHƯNG vẫn chạy mỗi câu
//   vài lần rồi lấy trung bình. Đừng kết luận từ 1 lần chạy.
// - Viết sáng tạo, sinh dữ liệu đa dạng: temperature cao hơn.
// =======================================================================

require("dotenv").config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL = "gemini-3.5-flash-lite";
const RUNS = 5; // Số lần gọi cho mỗi cấu hình
const PROMPT =
  "Đặt 1 tên cho một quán cà phê nhỏ ở Đà Lạt. Chỉ trả lời đúng tên, không giải thích.";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/** In tiêu đề từng phần */
function section(title) {
  console.log(`\n========== ${title} ==========`);
}

/**
 * Gửi cùng 1 prompt RUNS lần với cùng 1 cấu hình, trả về mảng câu trả lời.
 * Các lần gọi chạy song song (Promise.all) cho nhanh.
 */
async function sample(generationConfig) {
  const model = genAI.getGenerativeModel({ model: MODEL, generationConfig });
  const results = await Promise.all(
    Array.from({ length: RUNS }, () => model.generateContent(PROMPT)),
  );
  return results.map((r) => r.response.text().trim());
}

/** In từng câu trả lời và đếm có bao nhiêu câu khác nhau */
function report(answers) {
  answers.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
  console.log(`  -> ${new Set(answers).size}/${answers.length} câu khác nhau`); // Set tự bỏ câu trùng
}

async function main() {
  console.log(`Prompt: "${PROMPT}" — gọi ${RUNS} lần mỗi cấu hình`);

  section("1. temperature = 0 (ổn định nhất)");
  report(await sample({ temperature: 0 }));
  // Lý thuyết: 5 câu giống hệt. Thực tế: phần lớn trùng nhưng vẫn có câu khác

  section("2. temperature = 1 (mức mặc định hay dùng)");
  report(await sample({ temperature: 1 }));

  section("3. temperature = 2 (liều nhất)");
  report(await sample({ temperature: 2 }));

  section("4. temperature = 2 nhưng topK = 1");
  // Lý thuyết: topK = 1 chỉ còn 1 token để chọn -> temperature cao cũng không có tác dụng.
  // Thực tế vẫn ra nhiều câu khác -> đừng tin API làm đúng lý thuyết, phải tự đo
  report(await sample({ temperature: 2, topK: 1 }));
}

main().catch(console.error);
