// =======================================================================
// HUGGING FACE - GỌI MODEL QUA INFERENCE API
//
// 1 client dùng cho nhiều loại task, mỗi task chọn 1 model phù hợp:
// 1. chatCompletion: chat tự do với LLM.
// 2. translation: dịch văn bản (Việt -> Anh).
// 3. questionAnswering: trích câu trả lời từ 1 đoạn context cho sẵn.
//
// provider: nơi chạy model thật (Hugging Face chỉ chuyển request tới).
// Model không có ở provider đã chọn -> lỗi. Tra model hỗ trợ trên trang model của Hugging Face.
// =======================================================================

require("dotenv").config();

const { InferenceClient } = require("@huggingface/inference");

const hf = new InferenceClient(process.env.HUGGINGFACE_ACCESS_TOKEN);

// Chat với LLM, trả câu trả lời dạng text.
// Response theo format OpenAI: choices[0].message.content.
async function chat(message) {
  const response = await hf.chatCompletion({
    model: "openai/gpt-oss-20b",
    provider: "featherless-ai",
    messages: [
      {
        role: "user",
        content: message,
      },
    ],
  });

  return response.choices[0].message.content;
}

// Dịch văn bản tiếng Việt sang tiếng Anh.
// Model opus-mt chỉ dịch đúng 1 chiều (vi -> en). Chiều khác cần model khác.
// max_length: độ dài tối đa bản dịch (token), dài hơn bị cắt.
async function translate(text) {
  const response = await hf.translation({
    model: "Helsinki-NLP/opus-mt-vi-en",
    provider: "hf-inference",
    inputs: text,
    parameters: {
      max_length: 100,
    },
  });

  return response.translation_text;
}

// Hỏi đáp trên context cố định. Model chỉ trích 1 đoạn có sẵn trong context,
// không tự viết câu mới.
// Output: { answer, score, start, end }. start/end: vị trí đoạn trả lời trong context.
async function answerQuestion(question) {
  const response = await hf.questionAnswering({
    model: "deepset/roberta-base-squad2",
    provider: "hf-inference",
    inputs: {
      context: "The quick brown fox jumps over the lazy dog",
      question: question,
    },
  });

  return response;
}

// ===== KỊCH BẢN MINH HỌA =====
// Bỏ comment từng khối để thử task tương ứng.
// Kỳ vọng câu hỏi "What color is the fox?" -> answer "brown".
async function run() {
  // const chatResult = await chat("Hi, can you tell me a joke?");
  // console.log(chatResult);

  // const translateResult = await translate("Kể cho tôi một câu chuyện cười");
  // console.log(translateResult);

  const answerResult = await answerQuestion("What color is the fox?");
  console.log(answerResult);

}

run();
