const fs = require("fs");
const path = require("path");
const https = require("https");

const githubToken = process.env.GITHUB_TOKEN;
const ollamaKey = process.env.OLLAMA_API_KEY;

// FIX 1: Explicitly grab index [0] to extract ONLY the username string
const repoEnv = process.env.GITHUB_REPOSITORY || "";
const username = repoEnv.split("/")[0];

// Target the caller's checked out repository workspace folder root
const userWorkspace = process.env.USER_WORKSPACE || process.cwd();
const postsDir = path.join(userWorkspace, "_posts");

if (!fs.existsSync(postsDir)) fs.mkdirSync(postsDir, { recursive: true });

// Utility: Make HTTPS request
function makeRequest(url, method = "GET", headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { "User-Agent": "GitHub-Actions-Bot", ...headers };
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: requestHeaders,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Fetch authenticated GitHub username
async function getPublicRepos() {
  console.log(`Fetching public repos for ${username}...`);
  const repos = [];
  let page = 1;

  while (true) {
    const url = `https://github.com/{username}/repos?type=public&page=${page}&per_page=100`;
    const res = await makeRequest(url, "GET", {
      Authorization: `token ${githubToken}`,
      Accept: "application/vnd.github.v3+json",
    });

    const data = JSON.parse(res.data);
    if (!Array.isArray(data) || data.length === 0) break;

    data.forEach((repo) => {
      if (
        !repo.archived &&
        repo.name.toLowerCase() !== username.toLowerCase()
      ) {
        repos.push({
          name: repo.name,
          default_branch: repo.default_branch,
        });
      }
    });
    page++;
  }

  return repos;
}

// Get last commit date on default branch
async function getLastCommitDate(repo) {
  const url = `https://github.com{username}/${repo.name}/commits?per_page=1`;
  const res = await makeRequest(url, "GET", {
    Authorization: `token ${githubToken}`,
    Accept: "application/vnd.github.v3+json",
  });

  const data = JSON.parse(res.data);
  // FIX 2: Restored the [0] array index notation from your original script
  if (Array.isArray(data) && data.length > 0) {
    return new Date(data[0].commit.committer.date);
  }
  return null;
}

// Get raw README content
async function getReadme(repo) {
  const url = `https://github.com{username}/${repo.name}/readme`;
  try {
    const res = await makeRequest(url, "GET", {
      Authorization: `token ${githubToken}`,
      Accept: "application/vnd.github.v3.raw",
    });
    return res.data;
  } catch {
    console.log(`  No README found for ${repo.name}`);
    return null;
  }
}

// Call Ollama Cloud API
async function generateArticle(readme) {
  const prompt =
    "You are a technical writer. Write a comprehensive blog article about the software project described in the README below.\n\n" +
    "Rules:\n" +
    "- Start the article directly. Do not include any preamble, disclaimer, or meta-commentary.\n" +
    "- Do not mention the README, yourself, or what you are about to do.\n" +
    '- Do not say phrases like "Based on the README", "I have extrapolated", "As described", or similar.\n' +
    "- If information is limited, write what you can from what is given. Do not acknowledge gaps.\n" +
    "- Use markdown formatting with headers, bullet points where appropriate.\n" +
    "- Use any markdown image or url that's available for your article. \n" +
    "- Don't invent any image url out of blue, use only what's available in the project source code or readme.md" +
    "- Write the articles in first person, since you are writing the articles on behalf of someone, use 'I', 'me' when referring" +
    "- Cover: what the project is, its purpose, key features, and potential use cases.\n\n" +
    "README:\n" +
    readme;

  const res = await makeRequest(
    "https://ollama.com",
    "POST",
    {
      Authorization: `Bearer ${ollamaKey}`,
      "Content-Type": "application/json",
    },
    { model: "gemma4:31b-cloud", prompt, stream: false },
  );

  const data = JSON.parse(res.data);
  return data.response || "";
}

function shouldUpdatePost(repoName, lastCommitDate) {
  if (!fs.existsSync(postsDir)) return true;
  const files = fs.readdirSync(postsDir);
  const escaped = repoName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})-${escaped}\\.md$`, "i");

  const existing = files.find((f) => pattern.test(f));
  if (!existing) return true;

  const match = existing.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return true;

  const commitDay = lastCommitDate.toISOString().substring(0, 10);
  return commitDay > match[1];
}

function removeOldPost(repoName, newFilename) {
  if (!fs.existsSync(postsDir)) return;
  const files = fs.readdirSync(postsDir);
  const escaped = repoName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}\\.md$`, "i");

  files
    .filter((f) => pattern.test(f) && f !== newFilename)
    .forEach((f) => {
      fs.unlinkSync(path.join(postsDir, f));
      console.log(`  Removed old post: ${f}`);
    });
}

function getPostFilename(repoName, commitDate) {
  const y = commitDate.getUTCFullYear();
  const m = String(commitDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(commitDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}-${repoName.toLowerCase()}.md`;
}

function getExcerpt(content, length = 100) {
  return (
    content
      .replace(/[#*_`[\]\n\r]/g, " ")
      .replace(/\s+/g, " ")
      .substring(0, length)
      .trim() + "..."
  );
}

function createPost(repoName, commitDate, article) {
  const excerpt = getExcerpt(article).replace(/"/g, "'");
  const dateStr =
    commitDate.toISOString().replace("T", " ").substring(0, 19) + " +0000";

  return [
    "---",
    "layout: post",
    `title: "${repoName}"`,
    `date: ${dateStr}`,
    "categories: projects",
    `excerpt: "${excerpt}"`,
    "---",
    "",
    article,
  ].join("\n");
}

function removeOrphanedPosts(repoNames) {
  if (!fs.existsSync(postsDir)) return;
  const files = fs.readdirSync(postsDir);
  const repoNamesLower = repoNames.map((n) => n.toLowerCase());

  files.forEach((f) => {
    const match = f.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
    if (!match) return;

    const postRepoName = match[1].toLowerCase();
    if (!repoNamesLower.includes(postRepoName)) {
      fs.unlinkSync(path.join(postsDir, f));
      console.log(`  Removed orphaned post: ${f}`);
    }
  });
}

// Main Runner Execution Engine
(async () => {
  try {
    const repos = await getPublicRepos();
    console.log(`Found ${repos.length} public repositories\n`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const repo of repos) {
      process.stdout.write(`Processing ${repo.name}... `);

      try {
        const lastCommitDate = await getLastCommitDate(repo);
        if (!lastCommitDate) {
          console.log("No commits found, skipping");
          skipped++;
          continue;
        }

        if (!shouldUpdatePost(repo.name, lastCommitDate)) {
          console.log("Up to date, skipping");
          skipped++;
          continue;
        }

        const readme = await getReadme(repo);
        if (!readme) {
          skipped++;
          continue;
        }

        console.log("Generating article...");
        const article = await generateArticle(readme);

        const filename = getPostFilename(repo.name, lastCommitDate);
        removeOldPost(repo.name, filename);
        const postPath = path.join(postsDir, filename);
        const isNew = !fs.existsSync(postPath);

        fs.writeFileSync(
          postPath,
          createPost(repo.name, lastCommitDate, article),
        );
        console.log(`  ${isNew ? "Created" : "Updated"}: ${filename}`);
        isNew ? created++ : updated++;
      } catch (err) {
        console.log(`Error: ${err.message}`);
        skipped++;
      }
    }

    removeOrphanedPosts(repos.map((r) => r.name));
    console.log(
      `\nSummary: ${created} created, ${updated} updated, ${skipped} skipped`,
    );
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exit(1);
  }
})();
