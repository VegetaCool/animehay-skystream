(function () {
  function ok(cb, data) {
    cb({ success: true, data: data });
  }

  function fail(cb, code, err) {
    cb({ success: false, errorCode: code, message: String(err && err.stack ? err.stack : err) });
  }

  function text(v) {
    return (v || "").toString().replace(/\s+/g, " ").trim();
  }

  function absUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    return new URL(url, manifest.baseUrl).toString();
  }

  function toScore(value) {
    var n = parseFloat(text(value).replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }

  function parseStatus(v) {
    var s = text(v).toLowerCase();
    if (s.indexOf("hoàn thành") >= 0 || s.indexOf("hoan thanh") >= 0 || s.indexOf("completed") >= 0) return "completed";
    if (s.indexOf("đang") >= 0 || s.indexOf("dang") >= 0 || s.indexOf("ongoing") >= 0) return "ongoing";
    return "ongoing";
  }

  function inferType(cardText) {
    var t = text(cardText).toLowerCase();
    if (t.indexOf("phút") >= 0 || t.indexOf("phut") >= 0) return "movie";
    return "anime";
  }

  async function fetchHtml(url) {
    var res = await http_get(url, { Referer: manifest.baseUrl, Origin: manifest.baseUrl });
    var status = (res && (res.status || res.statusCode || res.code)) || 0;
    var body = typeof res === "string" ? res : (res && res.body) || "";
    if (status >= 400 || !body) {
      throw new Error("HTTP " + status + " while requesting " + url);
    }
    return body;
  }

  function cardToItem(card) {
    var a = card.querySelector("a[href*='/thong-tin-phim/']") || card.querySelector("a");
    if (!a) return null;

    var title = text((card.querySelector("div.name-movie") || {}).textContent) || text(a.getAttribute("title"));
    var url = absUrl(a.getAttribute("href"));
    var img = card.querySelector("img");
    var poster = absUrl(img ? img.getAttribute("src") : "");
    var score = toScore((card.querySelector("div.score") || {}).textContent);
    var latest = text((card.querySelector("div.episode-latest") || {}).textContent);

    if (!title || !url) return null;

    return new MultimediaItem({
      title: title,
      url: url,
      posterUrl: poster,
      type: inferType(latest),
      score: score
    });
  }

  async function scrapeListing(url) {
    var html = await fetchHtml(url);
    var doc = await parseHtml(html);
    var cards = doc.querySelectorAll(".movies-list > .movie-item");
    if (!cards || cards.length === 0) {
      cards = doc.querySelectorAll(".movie-item");
    }

    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var item = cardToItem(cards[i]);
      if (item) out.push(item);
    }
    return out;
  }

  async function getHome(cb) {
    try {
      var data = {};
      data["Trending"] = await scrapeListing(absUrl("/phim-moi-cap-nhap/trang-1.html"));
      data["Shounen"] = await scrapeListing(absUrl("/the-loai/shounen-16/trang-1.html"));
      data["Hanh Dong"] = await scrapeListing(absUrl("/the-loai/hanh-dong-2/trang-1.html"));
      data["Hoc Duong"] = await scrapeListing(absUrl("/the-loai/hoc-duong-9/trang-1.html"));
      data["Xuyen Khong"] = await scrapeListing(absUrl("/the-loai/xuyen-khong-37/trang-1.html"));
      ok(cb, data);
    } catch (e) {
      fail(cb, "HOME_ERROR", e);
    }
  }

  async function search(query, cb) {
    try {
      var q = encodeURIComponent(text(query || ""));
      var url = absUrl("/tim-kiem/" + q + ".html");
      var items = await scrapeListing(url);
      ok(cb, items);
    } catch (e) {
      fail(cb, "SEARCH_ERROR", e);
    }
  }

  function parseEpisodeNumber(nameText, fallbackIndex) {
    var m = text(nameText).match(/(\d+(?:\.\d+)?)/);
    if (!m) return fallbackIndex;
    var n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return fallbackIndex;
    return Math.max(0, Math.round(n));
  }

  function toInt(value, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.round(n);
  }

  async function load(url, cb) {
    try {
      var html = await fetchHtml(url);
      var doc = await parseHtml(html);

      var title = text((doc.querySelector("h1.heading_movie") || {}).textContent);
      var poster = absUrl((doc.querySelector(".info-movie .head .first img") || {}).getAttribute && doc.querySelector(".info-movie .head .first img").getAttribute("src"));
      if (!poster) {
        poster = absUrl((doc.querySelector("meta[property='og:image']") || {}).getAttribute && doc.querySelector("meta[property='og:image']").getAttribute("content"));
      }

      var description = text((doc.querySelector("#ah_wrapper > div.ah_content > div.info-movie > div.body > div.desc.ah-frame-bg > div:nth-child(2)") || {}).textContent);
      if (!description) {
        description = text((doc.querySelector("meta[name='description']") || {}).getAttribute && doc.querySelector("meta[name='description']").getAttribute("content"));
      }

      var status = parseStatus((doc.querySelector(".info-movie .status > div:nth-child(2)") || {}).textContent);
      var yearText = text((doc.querySelector(".info-movie .update_time > div:nth-child(2)") || {}).textContent);
      var yearMatch = yearText.match(/(19\d{2}|20\d{2})/);
      var year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

      var score = toScore((doc.querySelector(".info-movie .score > div:nth-child(2)") || {}).textContent);

      var tagNodes = doc.querySelectorAll("div.info-movie a[href^='/the-loai/']");
      var tags = [];
      for (var t = 0; t < tagNodes.length; t++) {
        var tag = text(tagNodes[t].textContent);
        if (tag) tags.push(tag);
      }

      var eps = doc.querySelectorAll("#ah_wrapper > div.ah_content > div.info-movie > div.body > div.list_episode.ah-frame-bg > div.list-item-episode.scroll-bar > a");
      if (!eps || eps.length === 0) {
        eps = doc.querySelectorAll(".info-movie .list-item-episode a");
      }

      var episodes = [];
      for (var i = 0; i < eps.length; i++) {
        var epNode = eps[i];
        var epUrl = absUrl(epNode.getAttribute("href"));
        var epName = text(epNode.textContent);
        if (!epUrl) continue;

        episodes.push(new Episode({
          name: epName || ("Tap " + (i + 1)),
          url: epUrl,
          season: 1,
          episode: toInt(parseEpisodeNumber(epName, i + 1), i + 1)
        }));
      }

      episodes.sort(function (a, b) {
        return (a.episode || 0) - (b.episode || 0);
      });

      ok(cb, new MultimediaItem({
        title: title || "AnimeHay",
        url: url,
        posterUrl: poster || "",
        type: episodes.length > 1 ? "anime" : "movie",
        description: description,
        status: status,
        year: year,
        score: score,
        tags: tags,
        episodes: episodes
      }));
    } catch (e) {
      fail(cb, "LOAD_ERROR", e);
    }
  }

  function pushStream(list, url, source, headers, forceProxy) {
    if (!url) return;
    var finalUrl = url;
    if (forceProxy) {
      try {
        var raw = absUrl(url);
        finalUrl = "MAGIC_PROXY_v1" + btoa(raw);
      } catch (e) {
        finalUrl = absUrl(url);
      }
    } else if (
      !url.startsWith("MAGIC_PROXY_v1") &&
      !url.startsWith("MAGIC_PROXY:") &&
      !url.startsWith("MAGIC_PROXY_v2")
    ) {
      finalUrl = absUrl(url);
    }

    list.push(new StreamResult({
      url: finalUrl,
      source: source,
      headers: headers || {
        Referer: manifest.baseUrl,
        Origin: manifest.baseUrl,
        "User-Agent": "Mozilla/5.0"
      }
    }));
  }

  async function loadStreams(url, cb) {
    try {
      var html = await fetchHtml(url);
      var streams = [];

      function addSsMirrors(ssUrl) {
        if (!ssUrl) return;
        var base = ssUrl.split("?")[0];
        pushStream(streams, base + "?s=SU", "SU");
        pushStream(streams, base + "?s=SG&auto=true", "SG");
        pushStream(streams, base + "?s=HY", "HY (SS)");
      }

      var ssCase = html.match(/case\s*['\"]SS['\"][\s\S]*?src\s*=\s*['\"]([^'\"]+)['\"]/i);
      if (ssCase && ssCase[1]) {
        pushStream(streams, ssCase[1], "SS");
        addSsMirrors(absUrl(ssCase[1]));
      }

      var hyCase = html.match(/case\s*['\"]HY['\"][\s\S]*?src\s*=\s*['\"]([^'\"]+)['\"]/i);
      if (hyCase && hyCase[1]) {
        pushStream(streams, hyCase[1], "HY");
      }

      var tok = html.match(/tik\s*:\s*['\"]([^'\"]+)['\"]/i);
      if (tok && tok[1]) {
        pushStream(streams, tok[1], "TOK", null, true);
      }

      var ss = html.match(/id=\\"ss_if\\"[^\\n]*?src=\\"([^\\"]+)\\"/i) || html.match(/id=['\"]ss_if['\"][^\n]*?src=['\"]([^'\"]+)['\"]/i);
      if (ss && ss[1]) {
        pushStream(streams, ss[1], "SS (Embed)");
        addSsMirrors(absUrl(ss[1]));
      }

      var hy = html.match(/playhydrax\.com\/\?v=([A-Za-z0-9_-]+)/i);
      if (hy && hy[1]) {
        pushStream(streams, "https://playhydrax.com/?v=" + hy[1], "HY (Embed)");
      }

      var directM3u8 = html.match(/https?:\/\/[^'\"\s]+\.m3u8[^'\"\s]*/gi) || [];
      for (var i = 0; i < directM3u8.length; i++) {
        pushStream(streams, directM3u8[i], "M3U8", null, true);
      }

      var directMp4 = html.match(/https?:\/\/[^'\"\s]+\.mp4[^'\"\s]*/gi) || [];
      for (var k = 0; k < directMp4.length; k++) {
        pushStream(streams, directMp4[k], "MP4");
      }

      var iframeSrcs = html.match(/<iframe[^>]+src=["']([^"']+)["']/gi) || [];
      for (var x = 0; x < iframeSrcs.length; x++) {
        var m = iframeSrcs[x].match(/src=["']([^"']+)["']/i);
        if (m && m[1]) {
          pushStream(streams, m[1], "Embed");
        }
      }

      var seen = {};
      var unique = [];
      for (var j = 0; j < streams.length; j++) {
        var key = streams[j].url;
        if (!seen[key]) {
          seen[key] = true;
          unique.push(streams[j]);
        }
      }

      ok(cb, unique);
    } catch (e) {
      fail(cb, "STREAM_ERROR", e);
    }
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
