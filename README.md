# Automated Repo Article Generator

A GitHub Action that automatically scans your public repositories, generates comprehensive blog articles from their READMEs using the Ollama Cloud AI, and publishes them as dated Jekyll `_posts` markdown files.

## How It Works

1. Fetches all public, non-archived repositories for the authenticated user
2. Checks each repo's last commit date against any existing post
3. If a repo has a new commit since the last generated post, fetches its `README.md`
4. Sends the README to Ollama Cloud (`gemma4:31b-cloud`) to generate a full blog article
5. Writes the article as a dated `_posts/YYYY-MM-DD-repo-name.md` file
6. Removes posts for repos that have been deleted
7. Commits and pushes all changes back to your repository

## Requirements

- A Jekyll-based blog repository (e.g. GitHub Pages)
- An [Ollama Cloud](https://ollama.com) account and API key
- Workflow write permissions enabled

## Usage

```yaml
name: Daily Repo Article Generator

on:
  schedule:
    - cron: "0 8 * * *" # Runs daily at 8 AM UTC
  workflow_dispatch:

permissions:
  contents: write

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Generate blog posts
        uses: NishadNYC/automated-repo-article-generator@v1
        with:
          ollama-api-key: ${{ secrets.OLLAMA_API_KEY }}
```

## Inputs

| Input            | Description                                              | Required | Default               |
| ---------------- | -------------------------------------------------------- | -------- | --------------------- |
| `github-token`   | GitHub token used to read repo contents and push changes | No       | `${{ github.token }}` |
| `ollama-api-key` | API key for Ollama Cloud authentication                  | Yes      | —                     |

## Setup

### 1. Add your Ollama API key

Go to your repository **Settings → Secrets and variables → Actions → New repository secret** and add:

- Name: `OLLAMA_API_KEY`
- Value: your Ollama Cloud API key

### 2. Enable write permissions

Go to **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**.

### 3. Add the workflow file

Create `.github/workflows/generate-posts.yml` in your Jekyll repo with the usage example above.

### 4. Trigger manually or wait for schedule

Use the **Actions** tab → **Daily Repo Article Generator** → **Run workflow** to trigger it immediately, or wait for the daily cron.

## Generated Post Format

Each generated post includes Jekyll frontmatter and a full AI-written article:

```markdown
---
layout: post
title: "your-repo-name"
date: 2026-09-10 13:23:14 +0000
categories: projects
excerpt: "First 100 characters of the generated article..."
---

## Full article content here...
```

## Smart Update Logic

- **Skips unchanged repos** — only processes repos with a commit newer than the existing post date
- **Cleans up deleted repos** — removes posts for repos that no longer exist
- **No duplicate posts** — replaces the old dated file only when the commit date has changed
- **Skips repos without a README** — silently moves on if no README is found

## License

MIT
