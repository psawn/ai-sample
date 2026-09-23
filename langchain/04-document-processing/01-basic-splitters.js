// =======================================================================
// DOCUMENT PROCESSING - BƯỚC 1: TEXT SPLITTER CƠ BẢN
//
// LLM chỉ đọc được số token giới hạn mỗi lần gọi (context window).
// -> Cắt văn bản dài thành chunk nhỏ trước khi embedding.
//
// 2 tham số chính:
// 1. chunkSize: độ dài tối đa của 1 chunk (ký tự).
// 2. chunkOverlap: phần lặp lại giữa 2 chunk liền kề, tránh mất ngữ cảnh ở ranh giới.
//
// So sánh 2 splitter:
// - RecursiveCharacterTextSplitter: ưu tiên cắt ở khoảng trắng, không cắt ngang chữ.
// - CharacterTextSplitter: chỉ cắt theo 1 separator (mặc định "\n\n").
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const {
  CharacterTextSplitter,
  RecursiveCharacterTextSplitter,
} = require("@langchain/textsplitters");

// In từng chunk có đánh số { 1: chunk, 2: chunk, ... } cho dễ nhìn.
function show(title, chunks) {
  console.log(`\n=== ${title} ===`);
  console.log(Object.fromEntries(chunks.map((chunk, i) => [i + 1, chunk])));
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const chunkSize = 26;
  // chunkOverlap: số ký tự cuối chunk trước được lặp lại ở đầu chunk sau.
  // Đây là mức tối đa, thực tế có thể ít hơn (không phải luôn đúng 4 ký tự).
  const chunkOverlap = 4;
  const rSplitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });
  const cSplitter = new CharacterTextSplitter({ chunkSize, chunkOverlap });

  const text1 = "abcdefghijklmnopqrstuvwxyz";
  const text2 = "abcdefghijklmnopqrstuvwxyzabcdefg";
  const text3 = "a b c d e f g h i j k l m n o p q r s t u v w x y z";

  // 1. Vừa đúng chunkSize -> không cần cắt, trả về nguyên 1 chunk.
  show("text1 (26 ký tự = chunkSize)", await rSplitter.splitText(text1));

  // 2. Dài hơn chunkSize -> cắt nhiều chunk, có overlap giữa 2 chunk liền kề.
  show(
    "text2 (dài hơn chunkSize -> có overlap)",
    await rSplitter.splitText(text2),
  );

  // 3. Recursive ưu tiên cắt ở khoảng trắng, không cắt ngang chữ.
  // Dấu cách cũng tính vào overlap (vd "l m" = 3 ký tự)
  // -> overlap = 4 chỉ giữ được 2 chữ, không phải 4 chữ.
  show(
    "text3 với RecursiveCharacterTextSplitter",
    await rSplitter.splitText(text3),
  );

  // 4. CharacterTextSplitter mặc định cắt theo "\n\n".
  // text3 không có "\n\n" -> không cắt được, trả về nguyên chuỗi.
  show(
    'text3 với CharacterTextSplitter (separator mặc định "\\n\\n")',
    await cSplitter.splitText(text3),
  );

  // 5. Đổi separator = " " để CharacterTextSplitter tách theo từ.
  const cSplitterWithSpace = new CharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separator: " ",
  });
  show(
    'text3 với CharacterTextSplitter (separator = " ")',
    await cSplitterWithSpace.splitText(text3),
  );
}

main();
