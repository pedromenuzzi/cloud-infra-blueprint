# Talk HTTP

> _curl and a real local server — speak the web's language._

**Belt 6 · Purple Belt** · Mission `6.3` · Lesson 3 · **100 XP** · ~30 min

---

The web is just requests and responses in plain text. `curl` lets you make them by hand — no browser, no mystery. You'll even stand up your own web server with one line of Python and talk to it, watching status codes tell the whole story.

## 📖 Learn

#### curl basics

```bash
curl http://example.com           # fetch the body
curl -I http://example.com        # HEAD — response headers only
curl -i http://example.com        # body WITH headers
curl -s http://example.com        # silent (no progress meter) — great in pipes
curl -o page.html http://...      # save to a file
```
_-I for headers, -s for scripting_

#### Status codes — the response's verdict

- **2xx** success — **200** OK is the one you want
- **3xx** redirect — **301** moved permanently, **302** found/temporary
- **4xx** your fault — **404** not found, **403** forbidden, **401** unauthorized
- **5xx** server's fault — **500** internal error, **502/503** upstream/unavailable

#### A web server in one line

```bash
python3 -m http.server 8099
# serves the CURRENT directory at http://localhost:8099
# Ctrl+C to stop; run it in another terminal or background it with &
```
_No install needed — Python is everywhere_

#### Reading just the status code

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8099/
#      │            │       └ print ONLY the status code
#      │            └ throw the body away
#      └ silent
```
_The scripting idiom for 'did it work?'_

> 💡 **Sensei says:** `curl` + status codes is how you health-check anything with a URL. `502` means the proxy can't reach the app behind it; `404` means the path is wrong, not the server. Codes localize the fault instantly.

## 🎯 Your Mission

1. A `www/` directory with an `index.html` is provided. Serve it in the background:

   ```bash
   cd www && python3 -m http.server 8099 & cd ..
   ```

2. Fetch the headers of the home page and save them into `headers.txt` (must contain the HTTP status line):

   ```bash
   curl -si http://localhost:8099/ | head -n 20 > headers.txt
   ```

3. Save the page body into `page.txt`:

   ```bash
   curl -s http://localhost:8099/ > page.txt
   ```

4. Request a page that does NOT exist and capture the status code into `miss.txt`:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8099/nope-not-here > miss.txt
   ```

5. Stop your server (`kill %1` or find its PID). Record in `answers.md`:

   ```bash
   code_ok=STATUS_FOR_A_PAGE_THAT_EXISTS
   code_missing=STATUS_FOR_A_PAGE_THAT_DOES_NOT
   redirect_code=THE_STATUS_CODE_FOR_A_PERMANENT_REDIRECT
   ```

## ✅ What the checker looks for

- **`headers.txt`** — response headers incl. an HTTP status line
- **`page.txt`** — the served index.html body
- **`miss.txt`** — the status code for a missing page (404)
- **`answers.md`** — code_ok=200, code_missing=404, redirect_code=301

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- If curl says 'connection refused', the server isn't up — re-run the python3 http.server line.
- code_ok=200, code_missing=404. A permanent redirect is 301 (temporary is 302).
- Free the port when done so it doesn't linger: `kill %1` stops a backgrounded job.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 6.3
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `6.2` · [🏠 Dojo map](../../../README.md) · Next: `6.4` ➡️
