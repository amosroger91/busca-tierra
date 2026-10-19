import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { USER_AGENT } from "./config.js";

const CURL_FIRST_HOSTS = new Set([
  "www.landflip.com",
  "landflip.com",
  "www.land.com",
  "www.landsofamerica.com",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hostOf(url) {
  return new URL(url).host;
}

function cacheKey(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 24);
}

export function createHttp({ cacheDir, refresh = false, gapMs = 350 }) {
  const tails = new Map();

  function schedule(host, task) {
    const previous = tails.get(host) || Promise.resolve();
    const run = previous.then(async () => {
      await sleep(gapMs);
      return task();
    });
    tails.set(
      host,
      run.then(
        () => {},
        () => {}
      )
    );
    return run;
  }

  async function readCache(url) {
    if (refresh) return null;
    try {
      const raw = await readFile(path.join(cacheDir, `${cacheKey(url)}.json`), "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function writeCache(url, result) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, `${cacheKey(url)}.json`),
      JSON.stringify({ status: result.status, url: result.url, text: result.text })
    );
  }

  async function viaFetch(url) {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(45000),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    return {
      status: response.status,
      url: response.url,
      text: await response.text(),
    };
  }

  function viaCurl(url) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "curl.exe",
        [
          "-sS",
          "-L",
          "--max-redirs",
          "5",
          "--max-time",
          "45",
          "-A",
          USER_AGENT,
          "-H",
          "Accept: text/html,application/json;q=0.9,*/*;q=0.8",
          "-H",
          "Accept-Language: en-US,en;q=0.9",
          "-w",
          "\n__HTTP__%{http_code} %{url_effective}",
          url,
        ],
        { windowsHide: true }
      );
      const chunks = [];
      const errors = [];
      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.stderr.on("data", (chunk) => errors.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(Buffer.concat(errors).toString("utf8") || `curl exited ${code}`));
          return;
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        const marker = raw.lastIndexOf("\n__HTTP__");
        if (marker < 0) {
          reject(new Error("curl response had no status marker"));
          return;
        }
        const text = raw.slice(0, marker);
        const [status, ...rest] = raw.slice(marker + "\n__HTTP__".length).trim().split(" ");
        resolve({
          status: Number(status),
          url: rest.join(" ") || url,
          text,
        });
      });
    });
  }

  async function request(url) {
    const host = hostOf(url);
    if (CURL_FIRST_HOSTS.has(host)) {
      try {
        return await viaCurl(url);
      } catch {
        return viaFetch(url);
      }
    }
    try {
      const result = await viaFetch(url);
      if (result.status === 403 || result.status === 429 || result.status === 503) {
        try {
          const curled = await viaCurl(url);
          if (curled.status < 400 || curled.status < result.status) return curled;
        } catch {
          return result;
        }
      }
      return result;
    } catch {
      return viaCurl(url);
    }
  }

  async function getText(url) {
    const cached = await readCache(url);
    if (cached) return { ...cached, fromCache: true };
    const result = await schedule(hostOf(url), () => request(url));
    if (result.status === 200 || result.status === 404 || result.status === 403) {
      await writeCache(url, result);
    }
    return { ...result, fromCache: false };
  }

  async function getJson(url) {
    const result = await getText(url);
    let data = null;
    try {
      data = JSON.parse(result.text);
    } catch {
      data = null;
    }
    return { ...result, data };
  }

  return { getText, getJson };
}
