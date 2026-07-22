// 產生隨機短碼的小函式
function generateCode(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { url } = await request.json();

    // 基本檢查：是不是合法的 http/https 網址
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return Response.json({ error: "Please provide a valid URL starting with http:// or https://" }, { status: 400 });
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return Response.json({ error: "Please provide a valid URL starting with http:// or https://" }, { status: 400 });
    }

    // 產生一個不重複的短碼
    let code;
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateCode();
      const existing = await env.DB.prepare(
        "SELECT short_code FROM links WHERE short_code = ?"
      ).bind(code).first();
      if (!existing) break; // 沒撞到，就用這個
    }

    // 存進資料庫
    await env.DB.prepare(
      "INSERT INTO links (short_code, target_url) VALUES (?, ?)"
    ).bind(code, url).run();

    return Response.json({ short_code: code, target_url: url });
  } catch (err) {
    return Response.json({ error: "伺服器錯誤：" + err.message }, { status: 500 });
  }
}
