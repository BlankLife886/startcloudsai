// Node.js 20+ with the official SDK: npm install openai
// Run on your server; never ship the API Key in a browser bundle.
//
//   STAR_CLOUD_BASE_URL=https://example.com/v1 STAR_CLOUD_API_KEY=sk-sc-... \
//     node examples/open-api/openai_images.mjs models
//   ... node examples/open-api/openai_images.mjs generate <model> "<prompt>" <output-file>
import { writeFile } from 'node:fs/promises';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.STAR_CLOUD_API_KEY,
  baseURL: process.env.STAR_CLOUD_BASE_URL,
  timeout: 270_000,
  // A failed request is not charged; SDK retries would only start new paid requests.
  maxRetries: 0,
});

const [command, model, prompt, output] = process.argv.slice(2);

if (command === 'models') {
  for await (const item of client.models.list()) console.log(item.id);
} else if (command === 'generate' && model && prompt && output) {
  const result = await client.images.generate({ model, prompt, n: 1, size: 'auto', response_format: 'b64_json' });
  await writeFile(output, Buffer.from(result.data[0].b64_json, 'base64'), { flag: 'wx' });
  console.log(`saved ${output}`);
} else {
  console.error('usage: openai_images.mjs models | generate <model> <prompt> <output-file>');
  process.exitCode = 2;
}
