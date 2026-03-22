(function () {
  const manifest = {
    id: "animehay",
    name: "AnimeHay",
    version: 3,
    baseUrl: "https://animehay.ngo"
  };

  async function request(url, options = {}) {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": manifest.baseUrl + "/",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        ...(options.headers || {})
      },
      body: options.body,
      credentials: "include"
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return await res.text();
  }

  function parseHTML(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  function absolute(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("//")) return "https:" + url;
    return manifest.baseUrl + (url.startsWith("/") ? url : "/" + url);
  }

  function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function getText(root, selector) {
    const el = root.querySelector(selector);
    return cleanText(el?.textContent || "");
  }

  function getAttr(root, selector, attr) {
    const el = root.querySelector(selector);
    return el?.getAttribute(attr) || "";
  }

  function dedupeByUrl(items) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item?.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }

  function dedupeStreams(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = `${item.server || ""}::${item.type || ""}::${item.url || ""}`;
      if (!item?.url || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function parseEpisodeNumber(name) {
    const m = (name || "").match(/(\d+(\.\d+)?)/);
    return m ? parseFloat(m[1]) : 999999;
  }

  async function getHome() {
    const html = await request(`${manifest.baseUrl}/`);
    const doc = parseHTML(html);

    const anchors = [...doc.querySelectorAll("a[href*='/thong-tin-phim/']")];
    const items = anchors.map((a) => {
      const url = absolute(a.getAttribute("href"));
      const title =
        cleanText(a.getAttribute("title")) ||
        cleanText(a.querySelector("img")?.getAttribute("alt")) ||
        cleanText(a.textContent);

      const poster =
        absolute(a.querySelector("img")?.getAttribute("src")) ||
        absolute(a.querySelector("img")?.getAttribute("data-src"));

      if (!url || !title) return null;

      return {
        title,
        url,
        poster,
        type: "anime"
      };
    }).filter(Boolean);

    return [
      {
        name: "Anime mới",
        list: dedupeByUrl(items).slice(0, 30)
      }
    ];
  }

  async function search(query) {
    const keyword = encodeURIComponent(query);
    const urls = [
      `${manifest.baseUrl}/search/movie?query=${keyword}`,
      `${manifest.baseUrl}/search/tv?query=${keyword}`,
      `${manifest.baseUrl}/tim-kiem/?keyword=${keyword}`
    ];

    const results = [];

    for (const url of urls) {
      try {
        const html = await request(url);
        const doc = parseHTML(html);

        const anchors = [...doc.querySelectorAll("a[href*='/thong-tin-phim/']")];
        for (const a of anchors) {
          const itemUrl = absolute(a.getAttribute("href"));
          const title =
            cleanText(a.getAttribute("title")) ||
            cleanText(a.querySelector("img")?.getAttribute("alt")) ||
            cleanText(a.textContent);

          const poster =
            absolute(a.querySelector("img")?.getAttribute("src")) ||
            absolute(a.querySelector("img")?.getAttribute("data-src"));

          if (!itemUrl || !title) continue;

          results.push({
            title,
            url: itemUrl,
            poster,
            type: "anime"
          });
        }
      } catch (_) {}
    }

    return dedupeByUrl(results);
  }

  async function load(url) {
    const html = await request(url);
    const doc = parseHTML(html);

    const title = getText(doc, "h1.heading_movie") || getText(doc, "h1");
    const poster = absolute(getAttr(doc, ".head .first img", "src"));
    const description = getText(doc, ".desc > div:last-child");
    const altTitle = getText(doc, ".name_other > div:last-child");
    const status = getText(doc, ".status > div:last-child");
    const year = getText(doc, ".update_time > div:last-child");
    const duration = getText(doc, ".duration > div:last-child");

    const genres = [...doc.querySelectorAll(".list_cate a")]
      .map((a) => cleanText(a.textContent))
      .filter(Boolean);

    let episodes = [...doc.querySelectorAll(".list-item-episode a")]
      .map((a) => {
        const epUrl = absolute(a.getAttribute("href"));
        const epName =
          cleanText(a.getAttribute("title")) ||
          `Tập ${cleanText(a.textContent)}`;

        if (!epUrl) return null;
        return { name: epName, url: epUrl };
      })
      .filter(Boolean);

    if (!episodes.length) {
      const watchNow = getAttr(doc, 'a[title="Xem Ngay"]', "href");
      if (watchNow) {
        episodes = [{ name: "Tập 1", url: absolute(watchNow) }];
      }
    }

    episodes.sort((a, b) => parseEpisodeNumber(a.name) - parseEpisodeNumber(b.name));

    return {
      title,
      url,
      poster,
      description,
      altTitle,
      status,
      year,
      duration,
      genres,
      episodes
    };
  }

  async function loadStreams(url) {
    const html = await request(url);
    const doc = parseHTML(html);
    const streams = [];

    const tikMatch = html.match(/\$info_play_video\s*=\s*\{[\s\S]*?tik\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
    if (tikMatch?.[1]) {
      streams.push({
        server: "TOK",
        url: tikMatch[1],
        type: "hls",
        headers: {
          Referer: manifest.baseUrl + "/"
        }
      });
    }

    const hyMatch = html.match(/case\s*['"]HY['"]:[\s\S]*?src=["'](https:\/\/playhydrax\.com\/\?v=[^"']+)["']/i);
    if (hyMatch?.[1]) {
      streams.push({
        server: "HY",
        url: hyMatch[1],
        type: "embed"
      });
    }

    const ssMatch = html.match(/case\s*['"]SS['"]:[\s\S]*?src=["'](https:\/\/ssplay\.net\/v\/[^"']+)["']/i);
    if (ssMatch?.[1]) {
      streams.push({
        server: "SS",
        url: ssMatch[1],
        type: "embed"
      });
    }

    const rawPatterns = [
      /https:\/\/vip\.rapovideo\.xyz\/playlist\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
      /https:\/\/ssplay\.net\/v\/[^\s"'<>]+/gi,
      /https:\/\/playhydrax\.com\/\?v=[^\s"'<>]+/gi
    ];

    for (const re of rawPatterns) {
      const matches = [...html.matchAll(re)].map((m) => m[0]);
      for (const u of matches) {
        streams.push({
          server: guessServerName(u),
          url: u,
          type: u.includes(".m3u8") ? "hls" : "embed"
        });
      }
    }

    const iframeUrls = [...doc.querySelectorAll("iframe[src]")]
      .map((el) => absolute(el.getAttribute("src")))
      .filter(Boolean);

    for (const iframeUrl of iframeUrls) {
      if (/ssplay\.net|playhydrax\.com/i.test(iframeUrl)) {
        streams.push({
          server: guessServerName(iframeUrl),
          url: iframeUrl,
          type: "embed"
        });
      }
    }

    const priority = { TOK: 1, SS: 2, HY: 3 };
    return dedupeStreams(streams).sort((a, b) => {
      const pa = priority[a.server] || 99;
      const pb = priority[b.server] || 99;
      return pa - pb;
    });
  }

  function guessServerName(url) {
    if (/rapovideo/i.test(url) || /\.m3u8/i.test(url)) return "TOK";
    if (/ssplay\.net/i.test(url)) return "SS";
    if (/playhydrax\.com/i.test(url)) return "HY";
    return "Server";
  }

  return {
    manifest,
    getHome,
    search,
    load,
    loadStreams
  };
})();
