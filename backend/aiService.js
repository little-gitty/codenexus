import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

export async function generateCodePatch(brokenCode, errorMessage) {
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured.');
  }

  try {
    const prompt = `You are an automated code repair agent. Fix this broken JavaScript code.\n\nError: ${errorMessage}\n\nBroken Code:\n${brokenCode}\n\nReturn ONLY the corrected, executable JavaScript code. Do not include markdown formatting or extra explanations.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Groq API request failed.');
    }

    const patch = data?.choices?.[0]?.message?.content || '';
    const cleanedCode = patch.replace(/```(?:javascript)?/gi, '').replace(/```/g, '').trim();

    // Extract token usage from response
    const tokens = data.usage
      ? {
          prompt: data.usage.prompt_tokens || 0,
          completion: data.usage.completion_tokens || 0,
          total: data.usage.total_tokens || 0,
        }
      : { prompt: 0, completion: 0, total: 0 };

    return { code: cleanedCode, tokens };
  } catch (err) {
    console.error('Groq API call failed:', err.message);
    throw err;
  }
}