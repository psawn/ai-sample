require("dotenv").config();

const { InferenceClient } = require("@huggingface/inference");

const hf = new InferenceClient(process.env.HUGGINGFACE_ACCESS_TOKEN);

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

async function run() {
  // const chatResult = await chat("Hi, can you tell me a joke?");
  // console.log(chatResult);

  // const translateResult = await translate("Kể cho tôi một câu chuyện cười");
  // console.log(translateResult);

  const answerResult = await answerQuestion("What color is the fox?");
  console.log(answerResult);

}

run();
