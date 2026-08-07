# Who Am I Online

> _ip, interfaces, and the addresses that define you._

**Belt 6 · Purple Belt** · Mission `6.1` · Lesson 1 · **100 XP** · ~25 min

---

Before you can debug a network, you must read your own. What's my IP? Which interface carries traffic? What's loopback? Today the `ip` command replaces the old `ifconfig`, and the numbers stop being mysterious.

## 📖 Learn

#### The modern command

```bash
ip addr           # show all interfaces and their addresses (alias: ip a)
ip -brief addr    # compact one-line-per-interface view
ip route          # the routing table — where does traffic go?
ip link           # interfaces up/down, MAC addresses
```
_`ip` is the modern replacement for ifconfig_

#### Reading an interface

```bash
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> ...
    inet 192.168.7.42/24 brd 192.168.7.255 scope global eth0
#        └ your IP      └ /24 = subnet mask (prefix length)
```
_inet = the IPv4 address_

#### Interfaces you'll always see

- **lo** — loopback, always `127.0.0.1/8`. Traffic to yourself never leaves the machine.
- **eth0 / ens… / enp…** — a wired network card (names vary by distro).
- **wlan0 / wlp…** — wireless.
- **docker0 / veth…** — virtual interfaces from containers.

#### What /24 means (CIDR)

The `/24` after an address is the *prefix length* — how many leading bits are the network part. `/24` = 256 total addresses, of which **254** are usable hosts (one is the network address, one the broadcast). `/16` = 65,536 addresses. The bigger the number, the smaller the network. Private ranges (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) never appear on the public internet.

> 💡 **Sensei says:** `ip a` is muscle memory for every operator. When something 'can't connect', it's the first look: do I even have the address I think I have?

## 🎯 Your Mission

1. Capture your real interfaces (it will include the loopback line with 127.0.0.1):

   ```bash
   ip addr > interfaces.txt        # if `ip` is missing, use: ifconfig > interfaces.txt
   ```

2. A captured `sample/ip-a.txt` is provided so answers are identical for everyone. Read it and fill `answers.md`:

   ```bash
   private_ip=THE_192.168_ADDRESS_ON_eth0
   loopback=THE_LOOPBACK_ADDRESS
   cidr_hosts_24=HOW_MANY_USABLE_HOSTS_IN_A_/24_NETWORK
   ```

## ✅ What the checker looks for

- **`interfaces.txt`** — your real ip/ifconfig output (contains 127.0.0.1)
- **`answers.md`** — private_ip, loopback, cidr_hosts_24

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- private_ip is the `inet` line under eth0 in sample/ip-a.txt (without the /24).
- loopback is always 127.0.0.1.
- A /24 has 256 addresses minus 2 reserved = 254 usable hosts.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 6.1
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `5.5` · [🏠 Dojo map](../../../README.md) · Next: `6.2` ➡️
