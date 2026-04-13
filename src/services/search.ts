interface WikipediaSearchResponse {
  query?: {
    search?: Array<{
      title?: string;
      snippet?: string;
      timestamp?: string;
    }>;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  source: string;
  publishedAt?: string;
}

export type SearchFreshness = "pd" | "pw" | "pm";

const SEARCH_TIMEOUT_MS = 20_000;
const MAX_RESULTS = 5;

const ALLOWED_DOMAINS = [
  "wikipedia.org",
  "reuters.com",
  "bbc.com",
  "bbc.co.uk",
  "apnews.com",
  "npr.org",
] as const;

const NEWS_FEEDS = [
  {
    source: "Reuters",
    url: "https://feeds.reuters.com/reuters/topNews",
  },
  {
    source: "BBC",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
  },
  {
    source: "AP News",
    url: "https://apnews.com/hub/ap-top-news?output=1",
  },
  {
    source: "NPR",
    url: "https://feeds.npr.org/1001/rss.xml",
  },
] as const;

interface RssItem {
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedUrl(url: string): boolean {
  const domain = getDomain(url);
  if (!domain) {
    return false;
  }

  return ALLOWED_DOMAINS.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function tokenizeQuery(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  )];
}

function sanitizeNewsUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const keys = [...parsed.searchParams.keys()];
    for (const key of keys) {
      const normalized = key.toLowerCase();
      if (
        normalized.startsWith("utm_")
        || normalized.startsWith("at_")
        || normalized === "fbclid"
        || normalized === "gclid"
        || normalized === "mc_cid"
        || normalized === "mc_eid"
      ) {
        parsed.searchParams.delete(key);
      }
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function freshnessToMs(freshness?: SearchFreshness): number | null {
  if (freshness === "pd") {
    return 24 * 60 * 60 * 1_000;
  }

  if (freshness === "pw") {
    return 7 * 24 * 60 * 60 * 1_000;
  }

  if (freshness === "pm") {
    return 30 * 24 * 60 * 60 * 1_000;
  }

  return null;
}

function extractTag(block: string, tagName: string): string {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match?.[1]) {
    return "";
  }

  return stripHtml(match[1]);
}

function parseRssItems(xml: string): RssItem[] {
  const itemBlocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => match[2])
    .filter(Boolean);

  const items: RssItem[] = [];
  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    const description = extractTag(block, "description") || extractTag(block, "summary");

    const linkFromTag = extractTag(block, "link");
    const linkFromHrefMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i);
    const rawUrl = normalizeWhitespace(linkFromTag || linkFromHrefMatch?.[1] || "");
    const url = sanitizeNewsUrl(rawUrl);

    const publishedAt = extractTag(block, "pubDate") || extractTag(block, "updated") || undefined;

    if (!title || !url || !isAllowedUrl(url)) {
      continue;
    }

    items.push({
      title,
      url,
      description: description || "No description.",
      publishedAt,
    });
  }

  return items;
}

function scoreResult(queryTokens: string[], title: string, description: string): number {
  const titleTokens = new Set(tokenizeQuery(title));
  const descriptionTokens = new Set(tokenizeQuery(description));

  let score = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) {
      score += 3;
    }

    if (descriptionTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

function isWithinFreshness(publishedAt: string | undefined, freshness?: SearchFreshness): boolean {
  const limitMs = freshnessToMs(freshness);
  if (!limitMs || !publishedAt) {
    return true;
  }

  const publishedTs = Date.parse(publishedAt);
  if (Number.isNaN(publishedTs)) {
    return true;
  }

  return Date.now() - publishedTs <= limitMs;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "NyxSearchBot/1.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "NyxSearchBot/1.0",
      Accept: "application/rss+xml, application/xml, text/xml, text/plain;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.text();
}

async function searchWikipedia(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "4",
    format: "json",
    utf8: "1",
    origin: "*",
  });

  const payload = await fetchJson<WikipediaSearchResponse>(`https://en.wikipedia.org/w/api.php?${params}`);
  const rows = payload.query?.search ?? [];

  const results: SearchResult[] = [];
  for (const row of rows) {
    const title = normalizeWhitespace(row.title ?? "");
    if (!title) {
      continue;
    }

    results.push({
      title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`,
      description: stripHtml(row.snippet ?? "No description."),
      source: "Wikipedia",
      publishedAt: row.timestamp,
    });
  }

  return results;
}

async function searchNewsFeeds(query: string, freshness?: SearchFreshness): Promise<SearchResult[]> {
  const tokens = tokenizeQuery(query);

  const settled = await Promise.allSettled(
    NEWS_FEEDS.map(async (feed) => {
      const xml = await fetchText(feed.url);
      const items = parseRssItems(xml);

      return items
        .filter((item) => isWithinFreshness(item.publishedAt, freshness))
        .map((item) => ({
          ...item,
          source: feed.source,
          score: scoreResult(tokens, item.title, item.description),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((item) => ({
          title: item.title,
          url: item.url,
          description: item.description,
          source: item.source,
          publishedAt: item.publishedAt,
        }));
    }),
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

export async function searchWeb(query: string, freshness?: SearchFreshness): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Search query cannot be empty.");
  }

  const [wikiSettled, newsSettled] = await Promise.allSettled([
    searchWikipedia(trimmed),
    searchNewsFeeds(trimmed, freshness),
  ]);

  const allResults = [wikiSettled, newsSettled]
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((result) => isAllowedUrl(result.url));

  const deduped = [...new Map(allResults.map((result) => [result.url, result])).values()];
  const tokens = tokenizeQuery(trimmed);

  const sorted = deduped
    .map((result) => ({
      result,
      score: scoreResult(tokens, result.title, result.description),
      publishedTs: result.publishedAt ? Date.parse(result.publishedAt) : 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return (b.publishedTs || 0) - (a.publishedTs || 0);
    })
    .map((entry) => entry.result)
    .slice(0, MAX_RESULTS);

  if (sorted.length > 0) {
    return sorted;
  }

  throw new Error("No results found from allowlisted sources for that query.");
}

export async function getLatestNews(
  freshness?: SearchFreshness,
  topic?: string,
  maxResults = 8,
): Promise<SearchResult[]> {
  const trimmedTopic = topic?.trim() ?? "";

  const fromFeeds = await Promise.allSettled(
    NEWS_FEEDS.map(async (feed) => {
      const xml = await fetchText(feed.url);
      const items = parseRssItems(xml)
        .filter((item) => isWithinFreshness(item.publishedAt, freshness))
        .map((item) => ({
          title: item.title,
          url: item.url,
          description: item.description,
          source: feed.source,
          publishedAt: item.publishedAt,
          score: trimmedTopic
            ? scoreResult(tokenizeQuery(trimmedTopic), item.title, item.description)
            : 1,
          publishedTs: item.publishedAt ? Date.parse(item.publishedAt) : 0,
        }))
        .filter((item) => item.score > 0);

      return items;
    }),
  );

  const merged = fromFeeds
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => isAllowedUrl(item.url));

  const deduped = [...new Map(merged.map((item) => [item.url, item])).values()];

  const sorted = deduped
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return (b.publishedTs || 0) - (a.publishedTs || 0);
    })
    .slice(0, Math.max(1, Math.min(maxResults, 12)))
    .map((item) => ({
      title: item.title,
      url: item.url,
      description: item.description,
      source: item.source,
      publishedAt: item.publishedAt,
    }));

  if (sorted.length === 0) {
    throw new Error("No news results found for the selected freshness/topic.");
  }

  return sorted;
}

export function formatSearchContext(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No web results were returned.";
  }

  return results
    .map((result, index) => {
      const publishedLine = result.publishedAt ? `\nPublished: ${result.publishedAt}` : "";
      return `${index + 1}. ${result.title}\nSource: ${result.source}\nURL: ${result.url}${publishedLine}\nSnippet: ${result.description}`;
    })
    .join("\n\n");
}
