// =======================================================================
// OPENAI - ĐẾM TOKEN VỚI TIKTOKEN
//
// Model không đọc chữ mà đọc token (mảng số).
// Encode prompt để xem model "nhìn thấy" gì và đếm số token.
// Chi phí và giới hạn context đều tính theo token.
// =======================================================================

// js-tiktoken: bản JS thuần của tiktoken, không dùng WASM nên không cần free().
const { encodingForModel } = require("js-tiktoken");

// Bảng mã của gpt-3.5-turbo. Mỗi model có bảng mã riêng,
// cùng 1 câu có thể ra số token khác nhau.
const encoder = encodingForModel("gpt-3.5-turbo");

// Chuyển prompt thành mảng token.
function encodePrompt(prompt) {
  return encoder.encode(prompt);
}

const prompt = "How are you today?";
const tokens = encodePrompt(prompt);

console.log("Encoded Prompt:", tokens);
console.log("Token count:", tokens.length);
// decode: đổi ngược mảng token về chữ.
console.log("Decoded:", encoder.decode(tokens));
