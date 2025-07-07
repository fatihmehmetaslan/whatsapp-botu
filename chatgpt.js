// chatgpt.js
const { Configuration, OpenAIApi } = require("openai");
require("dotenv").config(); // .env dosyasındaki API anahtarını almak için

// OpenAI API konfigürasyonu
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

// ChatGPT'ye mesaj gönderme fonksiyonu
async function askChatGPT(message) {
  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo", // Kullanmak istediğiniz model
      messages: [{ role: "user", content: message }],
    });

    // ChatGPT'den gelen cevabı döndürüyoruz
    return completion.data.choices[0].message.content;
  } catch (error) {
    console.error("OpenAI API hatası:", error);
    return "Şu anda yardımcı olamıyorum. Lütfen tekrar deneyin.";
  }
}

module.exports = { askChatGPT };
