// test-openai.js
require('dotenv').config();
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testAPI() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: 'Merhaba, nasılsınız?' }
      ]
    });
    console.log('✅ API Yanıtı:', response.choices[0].message.content);
  } catch (error) {
    console.error('❌ API Hatası:', error);
  }
}

testAPI();
