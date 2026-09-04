const { encoding_for_model } = require("tiktoken");

function encodePrompt(prompt) {
  const encoder = encoding_for_model("gpt-3.5-turbo");
  return encoder.encode(prompt);
}

const propt = "How are you today?";

console.log("Encoded Prompt:", encodePrompt(propt));
