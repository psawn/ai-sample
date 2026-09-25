// =======================================================================
// LLM FUNDAMENTALS 1: TOKENIZATION — MODEL "NHÌN" CHỮ NHƯ THẾ NÀO
// Bản cơ bản (chỉ encode + đếm): 01-sdk-basics/openai/02-count-tokens.js. Bài này đi sâu hơn.
//
// Token là gì?
// - Model không đọc từng chữ cái hay từng từ, mà đọc từng "mảnh" gọi là token.
//   VD: "How many orders" -> 3 token: "How" | " many" | " orders"
// - Tokenizer = bộ chia câu thành token. Mỗi model có tokenizer riêng
//   -> cùng 1 câu, model khác nhau đếm ra số token khác nhau.
// - Tiền API, tốc độ, giới hạn độ dài prompt đều tính theo TOKEN, không theo số chữ.
//
// Vì sao tiếng Việt không dấu lại tốn token hơn có dấu?
// - Tokenizer được tạo bằng cách: chuỗi nào gặp NHIỀU trong dữ liệu train thì gộp thành 1 token.
// - Tiếng Việt trên mạng hầu hết có dấu -> " được" = 1 token, còn " duoc" hiếm -> " du" + "oc".
// - Bỏ dấu còn làm model khó hiểu: "duoc" là "được", "dược" hay "đuốc"? => cứ viết có dấu.
//
// Bài này dùng 2 tokenizer:
// 1. o200k_base (của OpenAI GPT-4o): chạy ngay trên máy, xem được từng token.
// 2. Gemini: gọi API countTokens, chỉ biết TỔNG số token, không xem được từng mảnh.
// =======================================================================

require("dotenv").config();

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getEncoding } = require("js-tiktoken");

const MODEL = "gemini-3.5-flash-lite";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL }); // Chỉ dùng để đếm token, không sinh câu trả lời
const encoder = getEncoding("o200k_base"); // Tokenizer của OpenAI, chạy offline

/** In tiêu đề từng phần */
function section(title) {
  console.log(`\n========== ${title} ==========`);
}

/**
 * Cắt câu thành token rồi đổi từng token về chữ, để thấy tokenizer cắt ở đâu.
 * encode: câu -> mảng số (mỗi số = 1 token); decode: số -> chữ.
 * Token cắt đôi 1 chữ có dấu thì decode riêng sẽ hiện ký tự lỗi "�".
 */
function showPieces(text) {
  return encoder.encode(text).map((id) => encoder.decode([id]));
}

async function main() {
  section("1. Xem từng token (o200k_base)");
  const english = "How many orders did my shop receive last month?";
  const vietnamese = "Tháng trước shop của tôi nhận được bao nhiêu đơn hàng?";
  const vietnameseNoAccent = "Thang truoc shop cua toi nhan duoc bao nhieu don hang?";
  console.log("EN:", showPieces(english));
  console.log("VI có dấu:", showPieces(vietnamese));
  console.log("VI không dấu:", showPieces(vietnameseNoAccent)); // " được" = 1 token, " duoc" = " du" + "oc"

  section("2. Cùng 1 ý, 3 cách viết — đếm token bằng 2 tokenizer");
  const samples = {
    "Tiếng Anh": english,
    "Tiếng Việt có dấu": vietnamese,
    "Tiếng Việt không dấu": vietnameseNoAccent,
  };

  const rows = [];
  for (const [label, text] of Object.entries(samples)) {
    const { totalTokens } = await model.countTokens(text);
    rows.push({
      "Cách viết": label,
      "Ký tự": text.length, // Để so: số chữ KHÔNG phản ánh số token
      "o200k_base": encoder.encode(text).length,
      Gemini: totalTokens,
    });
  }
  console.table(rows);
  // Tiếng Việt tốn hơn tiếng Anh; bỏ dấu còn tốn hơn nữa => cứ viết có dấu

  section("3. Ví dụ thực tế: schema trong prompt Text-to-SQL tốn bao nhiêu?");
  // Model phải biết DB có bảng/cột gì mới viết được SQL -> mỗi câu hỏi phải gửi kèm schema
  const tableDdl =
    "CREATE TABLE orders (id SERIAL PRIMARY KEY, shop_id INT NOT NULL, customer_id INT NOT NULL, " +
    "status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, shipped_at TIMESTAMPTZ); " +
    "-- Đơn hàng của shop. status: pending | paid | shipped | cancelled | refunded\n";
  const { totalTokens: perTable } = await model.countTokens(tableDdl);

  // Ước lượng: giả sử bảng nào cũng dài cỡ bảng orders ở trên
  for (const tableCount of [10, 50, 200]) {
    console.log(`${tableCount} bảng ≈ ${perTable * tableCount} token / mỗi câu hỏi`);
  }
  // Câu hỏi ~15 token nhưng schema 200 bảng ~13.600 token => nên dùng schema retrieval (chỉ gửi bảng liên quan)
}

main().catch(console.error);
