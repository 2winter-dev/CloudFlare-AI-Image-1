async function handleRequest(request, env) {
  const url = new URL(request.url);
  let imagePrompt = url.searchParams.get('t');  // 获取生成图像的描述
  
  if (!imagePrompt) {
    return new Response('miss params', { status: 400 });
  }

  // 检查 KV 存储中是否已有图像
  let imageBuffer = await env.IMAGE_KV.get('image-' + imagePrompt);

  if (!imageBuffer) {
    //翻译优化
    let originPromptKey = imagePrompt;
    try{
     
      let transRes = await translate(imagePrompt,env);
      console.log(transRes);
      imagePrompt = transRes.result.translated_text
    }catch(e){

      console.log('翻译错误:')
      console.log(e)
    }
    // 如果没有缓存的图像，生成图像并存储
    console.log('提示词：',imagePrompt,originPromptKey)
    imageBuffer = await generateImageWithCloudflare(imagePrompt, env,originPromptKey);
  }

  // 返回图像二进制数据，浏览器会直接显示图像
  return new Response(imageBuffer, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=1800' }, 
  });
}

//@cf/meta/m2m100-1.2b
async function translate(text,env,input,output) {
  
  return await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.account_id}/ai/run/@cf/meta/m2m100-1.2b`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text,
      source_lang: input ? input : 'chinese',
      target_lang: output ? output : 'english',
    }),
  }).then((res)=>res.json());
}

async function generateImageWithCloudflare(prompt, env,originPromptKeys) {
  // 使用 Cloudflare 的图像生成模型进行图像生成
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.account_id}/ai/run/${env.CF_IMG2TEXT_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.CF_IMG2TEXT_MODEL,  // 使用 Cloudflare 的模型生成图像
      prompt: prompt,
      // num_steps: env.FLUX_NUM_STEPS
    }),
  });

  if (!response.ok) {
    throw new Error('生成图像失败');
  }

  // 获取返回的二进制图像内容
  const imageBuffer = await response.arrayBuffer();

  // 使用 `prompt` 作为唯一的 `key`，确保相同的提示词返回相同的图像
  const key = `image-${originPromptKeys}`;  // 使用提示词作为 key
  await env.IMAGE_KV.put(key, imageBuffer, { expirationTtl: 1800 });

  // 返回图像的二进制数据
  return imageBuffer;
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);  // 直接返回图像的二进制数据
  },
};
