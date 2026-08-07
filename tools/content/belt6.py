BELT = {
    "n": 6,
    "slug": "06-purple-belt",
    "name": "Purple Belt",
    "color": "#a855f7",
    "rank": "Net Runner",
    "motto": "The network is just files and ports. Learn to read both.",
    "notebook": "Draw the network diagnostic ladder: have an IP? → reach the internet? → does DNS "
                "resolve? → does the service answer? Then sketch the SSH key handshake (public on the "
                "server, private with you). Why is a key better than a password?",
    "missions": [

# ─────────────────────────────────────────────────────────────── 6.1
{
"id": "6.1", "slug": "01-who-am-i-online", "title": "Who Am I Online",
"tagline": "ip, interfaces, and the addresses that define you.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Before you can debug a network, you must read your own. What's my IP? Which interface "
         "carries traffic? What's loopback? Today the `ip` command replaces the old `ifconfig`, "
         "and the numbers stop being mysterious.",
"learn": [
{"h": "The modern command",
 "code": "ip addr           # show all interfaces and their addresses (alias: ip a)\nip -brief addr    # compact one-line-per-interface view\nip route          # the routing table — where does traffic go?\nip link           # interfaces up/down, MAC addresses",
 "label": "`ip` is the modern replacement for ifconfig"},
{"h": "Reading an interface",
 "code": "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> ...\n    inet 192.168.7.42/24 brd 192.168.7.255 scope global eth0\n#        └ your IP      └ /24 = subnet mask (prefix length)",
 "label": "inet = the IPv4 address"},
{"h": "Interfaces you'll always see",
 "list": [
   "**lo** — loopback, always `127.0.0.1/8`. Traffic to yourself never leaves the machine.",
   "**eth0 / ens… / enp…** — a wired network card (names vary by distro).",
   "**wlan0 / wlp…** — wireless.",
   "**docker0 / veth…** — virtual interfaces from containers.",
 ]},
{"h": "What /24 means (CIDR)",
 "p": "The `/24` after an address is the *prefix length* — how many leading bits are the "
      "network part. `/24` = 256 total addresses, of which **254** are usable hosts (one is the "
      "network address, one the broadcast). `/16` = 65,536 addresses. The bigger the number, "
      "the smaller the network. Private ranges (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) "
      "never appear on the public internet."},
{"tip": "`ip a` is muscle memory for every operator. When something 'can't connect', it's the "
        "first look: do I even have the address I think I have?"},
],
"task": [
{"step": "Capture your real interfaces (it will include the loopback line with 127.0.0.1):",
 "code": "ip addr > interfaces.txt        # if `ip` is missing, use: ifconfig > interfaces.txt"},
{"step": "A captured `sample/ip-a.txt` is provided so answers are identical for everyone. Read it and fill `answers.md`:",
 "code": "private_ip=THE_192.168_ADDRESS_ON_eth0\nloopback=THE_LOOPBACK_ADDRESS\ncidr_hosts_24=HOW_MANY_USABLE_HOSTS_IN_A_/24_NETWORK"},
],
"artifacts": [
["interfaces.txt", "your real ip/ifconfig output (contains 127.0.0.1)"],
["answers.md", "private_ip, loopback, cidr_hosts_24"],
],
"hints": [
"private_ip is the `inet` line under eth0 in sample/ip-a.txt (without the /24).",
"loopback is always 127.0.0.1.",
"A /24 has 256 addresses minus 2 reserved = 254 usable hosts.",
],
},

# ─────────────────────────────────────────────────────────────── 6.2
{
"id": "6.2", "slug": "02-ports-and-listeners", "title": "Ports & Listeners",
"tagline": "ss/netstat — who is listening, and should they be?",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Every network service sits on a *port* waiting for connections. Knowing what's "
         "listening — and spotting what *shouldn't* be — is core security hygiene. `ss` is the "
         "fast modern tool; a surprising open port is often the first sign of trouble.",
"learn": [
{"h": "Listing listeners",
 "code": "ss -tlnp\n#  -t tcp   -l listening only   -n numeric ports (don't resolve names)   -p process\nss -tulnp     # add -u for UDP too\nss -tan       # ALL tcp sockets (listening + established)",
 "label": "ss -tlnp = 'what TCP services are up, and who owns them'"},
{"h": "Reading a listener line",
 "code": "LISTEN 0 128  0.0.0.0:22   0.0.0.0:*  users:((\"sshd\",pid=901,fd=3))\n#              │      │                          └ the process\n#              │      └ port 22\n#              └ 0.0.0.0 = listening on ALL interfaces (world-reachable)",
 "label": "Bind address is the security-critical part"},
{"h": "0.0.0.0 vs 127.0.0.1 — the crucial difference",
 "p": "A service bound to **127.0.0.1** accepts connections *only from the same machine* — "
      "safe by design (databases, metrics endpoints should bind here). A service bound to "
      "**0.0.0.0** listens on every interface, reachable from the whole network. A database or "
      "cache on `0.0.0.0` is a classic exposure — that's how open Redis/Mongo instances get "
      "found and drained."},
{"h": "Well-known ports worth memorizing",
 "list": [
   "**22** SSH · **80** HTTP · **443** HTTPS · **53** DNS",
   "**5432** PostgreSQL · **3306** MySQL · **6379** Redis · **27017** MongoDB",
   "Ports 0–1023 are 'privileged' — only root can bind them.",
 ]},
{"tip": "`ss` replaced `netstat`; if `ss` isn't there, `netstat -tlnp` gives the same picture. "
        "Both answer 'what is this box exposing?' — a question you'll ask on every server."},
],
"task": [
{"step": "Capture your own listeners into `my-listeners.txt`:",
 "code": "ss -tlnp > my-listeners.txt 2>/dev/null || netstat -tlnp > my-listeners.txt 2>/dev/null || echo \"no listener tool available\" > my-listeners.txt"},
{"step": "A captured `sample/ss.txt` is provided. Analyze it and fill `answers.md`:",
 "code": "ssh_port=THE_PORT_sshd_LISTENS_ON\ndb_bind=THE_BIND_ADDRESS_OF_postgres     # is it local-only or exposed?\nexposed_risky=THE_PORT_OF_THE_CACHE_EXPOSED_ON_0.0.0.0   # redis is the danger\nhttps_process=THE_PROCESS_NAME_LISTENING_ON_443"},
],
"artifacts": [
["my-listeners.txt", "your real socket listing (or a graceful 'no tool' note)"],
["answers.md", "ssh_port, db_bind, exposed_risky, https_process"],
],
"hints": [
"postgres in the sample binds 127.0.0.1 — that's the safe, local-only address.",
"redis (port 6379) is bound to 0.0.0.0 in the sample — that's the risky exposure.",
"Port 443 is served by nginx in the sample.",
],
},

# ─────────────────────────────────────────────────────────────── 6.3
{
"id": "6.3", "slug": "03-talk-http", "title": "Talk HTTP",
"tagline": "curl and a real local server — speak the web's language.",
"xp": 100, "minutes": 30, "boss": False,
"intro": "The web is just requests and responses in plain text. `curl` lets you make them by "
         "hand — no browser, no mystery. You'll even stand up your own web server with one line "
         "of Python and talk to it, watching status codes tell the whole story.",
"learn": [
{"h": "curl basics",
 "code": "curl http://example.com           # fetch the body\ncurl -I http://example.com        # HEAD — response headers only\ncurl -i http://example.com        # body WITH headers\ncurl -s http://example.com        # silent (no progress meter) — great in pipes\ncurl -o page.html http://...      # save to a file",
 "label": "-I for headers, -s for scripting"},
{"h": "Status codes — the response's verdict",
 "list": [
   "**2xx** success — **200** OK is the one you want",
   "**3xx** redirect — **301** moved permanently, **302** found/temporary",
   "**4xx** your fault — **404** not found, **403** forbidden, **401** unauthorized",
   "**5xx** server's fault — **500** internal error, **502/503** upstream/unavailable",
 ]},
{"h": "A web server in one line",
 "code": "python3 -m http.server 8099\n# serves the CURRENT directory at http://localhost:8099\n# Ctrl+C to stop; run it in another terminal or background it with &",
 "label": "No install needed — Python is everywhere"},
{"h": "Reading just the status code",
 "code": "curl -s -o /dev/null -w \"%{http_code}\\n\" http://localhost:8099/\n#      │            │       └ print ONLY the status code\n#      │            └ throw the body away\n#      └ silent",
 "label": "The scripting idiom for 'did it work?'"},
{"tip": "`curl` + status codes is how you health-check anything with a URL. `502` means the "
        "proxy can't reach the app behind it; `404` means the path is wrong, not the server. "
        "Codes localize the fault instantly."},
],
"task": [
{"step": "A `www/` directory with an `index.html` is provided. Serve it in the background:",
 "code": "cd www && python3 -m http.server 8099 & cd .."},
{"step": "Fetch the headers of the home page and save them into `headers.txt` (must contain the HTTP status line):",
 "code": "curl -si http://localhost:8099/ | head -n 20 > headers.txt"},
{"step": "Save the page body into `page.txt`:",
 "code": "curl -s http://localhost:8099/ > page.txt"},
{"step": "Request a page that does NOT exist and capture the status code into `miss.txt`:",
 "code": "curl -s -o /dev/null -w \"%{http_code}\\n\" http://localhost:8099/nope-not-here > miss.txt"},
{"step": "Stop your server (`kill %1` or find its PID). Record in `answers.md`:",
 "code": "code_ok=STATUS_FOR_A_PAGE_THAT_EXISTS\ncode_missing=STATUS_FOR_A_PAGE_THAT_DOES_NOT\nredirect_code=THE_STATUS_CODE_FOR_A_PERMANENT_REDIRECT"},
],
"artifacts": [
["headers.txt", "response headers incl. an HTTP status line"],
["page.txt", "the served index.html body"],
["miss.txt", "the status code for a missing page (404)"],
["answers.md", "code_ok=200, code_missing=404, redirect_code=301"],
],
"hints": [
"If curl says 'connection refused', the server isn't up — re-run the python3 http.server line.",
"code_ok=200, code_missing=404. A permanent redirect is 301 (temporary is 302).",
"Free the port when done so it doesn't linger: `kill %1` stops a backgrounded job.",
],
},

# ─────────────────────────────────────────────────────────────── 6.4
{
"id": "6.4", "slug": "04-ssh-keys", "title": "SSH & Keys",
"tagline": "Generate a keypair, configure a host, never leak a secret.",
"xp": 100, "minutes": 30, "boss": False,
"intro": "SSH is how you reach every server you'll ever run. Passwords are the weak way in; "
         "**key pairs** are the professional way. Today you generate one, learn what must never "
         "leave your machine, and write an SSH config so `ssh dojo` just works.",
"learn": [
{"h": "The keypair idea",
 "p": "You generate two linked files: a **private key** (`id_ed25519`) that stays on your "
      "machine forever, and a **public key** (`id_ed25519.pub`) you copy onto servers. The "
      "server challenges you; only the matching private key can answer. The private key is the "
      "crown jewel — leak it and anyone becomes you."},
{"h": "Generating a modern key",
 "code": "ssh-keygen -t ed25519 -C \"you@dojo\" -f ./lab_key\n#           │              │            └ output file\n#           │              └ a label/comment\n#           └ ed25519: fast, tiny, modern (prefer over old RSA)\n# creates lab_key (private) and lab_key.pub (public)",
 "label": "ed25519 is today's default choice"},
{"h": "Permissions are enforced by SSH itself",
 "code": "chmod 700 ~/.ssh          # the directory: owner-only\nchmod 600 ~/.ssh/id_ed25519   # private key: owner read/write only\nchmod 644 ~/.ssh/id_ed25519.pub  # public key can be world-readable",
 "label": "SSH REFUSES to use a private key others can read"},
{"p": "If your private key is group- or world-readable, `ssh` prints 'UNPROTECTED PRIVATE KEY "
      "FILE' and refuses to use it. That's a feature. **600** on the private key is not optional."},
{"h": "The ~/.ssh/config shortcut",
 "code": "Host dojo\n    HostName 203.0.113.10\n    User tux\n    Port 2222\n    IdentityFile ~/.ssh/lab_key\n# now just: ssh dojo",
 "label": "Name your servers once, connect by nickname forever"},
{"h": "Never commit a private key",
 "p": "Private keys, `.env` files, and credentials must never enter git. A `.gitignore` entry "
      "(`lab_key`, `*.pem`, `.env`) is your safety net. `git check-ignore lab_key` confirms a "
      "path is ignored *before* you accidentally stage it."},
{"tip": "Real workflow: `ssh-copy-id dojo` pushes your public key to a server's "
        "`authorized_keys` so you can log in key-only. The public key is meant to be shared; "
        "the private one, never."},
],
"task": [
{"step": "Generate an ed25519 keypair in this folder, no passphrase for the lab (`-N \"\"`):",
 "code": "ssh-keygen -t ed25519 -C \"tux@dojo\" -f ./lab_key -N \"\""},
{"step": "Lock the private key to 600:",
 "code": "chmod 600 lab_key"},
{"step": "Write an SSH config snippet `ssh_config_lab` defining a `Host dojo` with HostName `203.0.113.10`, Port `2222`, and `IdentityFile` pointing at your lab_key (see the learn block for the shape)."},
{"step": "Create a `.gitignore` in this folder that ignores `lab_key` (the private key). Verify it's ignored:",
 "code": "echo \"lab_key\" > .gitignore\ngit check-ignore lab_key   # should print: lab_key"},
{"step": "Record in `answers.md`:",
 "code": "key_type=THE_ALGORITHM_YOU_USED       # ed25519\nnever_commit=WHICH_KEY_MUST_NEVER_BE_SHARED   # 'private' (the word)\nssh_dir_mode=THE_RECOMMENDED_MODE_FOR_~/.ssh   # 700"},
],
"artifacts": [
["lab_key + lab_key.pub", "a real ed25519 keypair; private key is 600"],
["ssh_config_lab", "Host dojo with HostName/Port/IdentityFile"],
[".gitignore", "ignores lab_key (git check-ignore confirms)"],
["answers.md", "key_type, never_commit, ssh_dir_mode"],
],
"hints": [
"`-N \"\"` sets an empty passphrase so the lab key generates without prompting.",
"The .pub file starts with `ssh-ed25519 ` — that's how the checker confirms the type.",
"never_commit is the word `private`; ssh_dir_mode is `700`.",
],
},

# ─────────────────────────────────────────────────────────────── 6.5
{
"id": "6.5", "slug": "05-boss-port-detective", "title": "BOSS — The Port Detective",
"tagline": "A backdoor is phoning home. Map the network crime scene.",
"xp": 250, "minutes": 45, "boss": True,
"intro": "The blue team flagged strange outbound traffic. You've got a casefile: socket dumps, "
         "the routing table, DNS settings, the hosts file, and a captured HTTP exchange. Somewhere "
         "in there is a backdoor and a hijacked domain. Read the network, name the crime.",
"learn": [
{"h": "Boss briefing — the casefile",
 "list": [
   "`casefile/ss-dump.txt` — every socket: listeners and established connections",
   "`casefile/route-dump.txt` — the routing table (`default via` = the gateway)",
   "`casefile/resolv.conf` — which DNS server the box uses (`nameserver …`)",
   "`casefile/hosts` — static name→IP overrides (a favorite attacker trick)",
   "`casefile/curl-verbose.txt` — a captured HTTP request/response",
 ]},
{"h": "What to look for",
 "list": [
   "A listener on a weird high port (like **31337** — hacker humor for 'eleet') owned by a tool like `nc` = a **backdoor**.",
   "An **ESTABLISHED** connection from that tool to an external IP = it's phoning home right now.",
   "An extra line in `hosts` pointing a real domain at an attacker IP = **DNS hijack** via the hosts file.",
   "The HTTP capture's status line tells you what the server answered (e.g. a 302 redirect).",
 ]},
{"h": "Tools you own",
 "code": "grep -i listen casefile/ss-dump.txt\ngrep default casefile/route-dump.txt      # the gateway\ngrep nameserver casefile/resolv.conf      # the DNS server\ntail -n +1 casefile/hosts                 # read the whole hosts file",
 "label": "Small greps, one fact each"},
{"tip": "The hosts file is checked *before* DNS. One malicious line there silently redirects "
        "`update-server.io` to an attacker box — so the victim downloads 'updates' from the "
        "wrong place. Reading `hosts` is a 10-second check with huge payoff."},
],
"task": [
{"step": "Prove loopback works on your own machine and save the evidence:",
 "code": "ping -c 1 127.0.0.1 | grep -i 'packets transmitted' > loopback-proof.txt"},
{"step": "Investigate every file in `casefile/` and write `netreport.md` with exactly these keys:",
 "code": "backdoor_port=THE_SUSPICIOUS_HIGH_PORT_LISTENING\nbackdoor_tool=THE_PROGRAM_HOLDING_THAT_PORT      # one word\ngateway=THE_default_via_IP_FROM_THE_ROUTE_TABLE\ndns_server=THE_nameserver_IP\nhijacked_domain=THE_DOMAIN_MAPPED_TO_A_STRANGE_IP_IN_hosts\nredirect_status=THE_HTTP_STATUS_CODE_IN_THE_curl_CAPTURE"},
],
"artifacts": [
["loopback-proof.txt", "a real ping summary line for 127.0.0.1"],
["netreport.md", "all six keys, correct values"],
],
"hints": [
"The backdoor port is the odd high one in ss-dump with `nc` next to it.",
"gateway comes from the `default via X.X.X.X` line; dns_server from `nameserver` in resolv.conf.",
"hijacked_domain is the domain on the suspicious third line of the hosts file.",
"redirect_status is the number on the `HTTP/1.1 ...` line of curl-verbose.txt.",
],
},

    ],
}
