#!/usr/bin/env bash
# Record the current PUBLIC DNS records of a domain (default ecomacrobiz.com)
# before moving DNS to Cloudflare, so every record can be recreated exactly.
#
#   bash scripts/dns-snapshot.sh [domain] [output-file]
#   -> docs/dns-snapshot-YYYY-MM-DD.txt
#
# Resolver: Cloudflare 1.1.1.1. Uses `dig @1.1.1.1` when dig exists, otherwise
# DNS-over-HTTPS (https://cloudflare-dns.com/dns-query) with curl + node (works
# in Git Bash on Windows). Read-only: only DNS queries are sent.
# Note: a resolver only sees names we ask for — a zone export from the Wix DNS
# dashboard is still the authoritative list (compare both before cutover).
set -euo pipefail

DOMAIN="${1:-ecomacrobiz.com}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${2:-$ROOT/docs/dns-snapshot-$(date -u +%Y-%m-%d).txt}"

HOSTS=(
  "@" www api mail webmail smtp email ftp m blog shop
  autodiscover lyncdiscover sip enterpriseregistration enterpriseenrollment msoid
  selector1._domainkey selector2._domainkey _dmarc
)
TYPES=(CNAME A AAAA MX TXT NS CAA)
SRV_HOSTS=(_sip._tls _sipfederationtls._tcp _autodiscover._tcp _sip._tcp)

if command -v dig >/dev/null 2>&1; then MODE=dig
elif command -v curl >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then MODE=doh
else echo "need dig, or curl + node" >&2; exit 1; fi

# Prints "name TTL type data" lines (empty when no record of that type).
query() {
  local name="$1" type="$2"
  if [ "$MODE" = dig ]; then
    dig @1.1.1.1 +noall +answer "$name" "$type" | awk -v t="$type" '$4==t {printf "%s %s %s", $1, $2, $4; for (i=5;i<=NF;i++) printf " %s", $i; print ""}'
  else
    curl -fsS --max-time 15 -H 'accept: application/dns-json' \
      "https://cloudflare-dns.com/dns-query?name=${name}&type=${type}" |
    node -e '
      const want = process.argv[1];
      const names = {1:"A",2:"NS",5:"CNAME",6:"SOA",15:"MX",16:"TXT",28:"AAAA",33:"SRV",43:"DS",48:"DNSKEY",257:"CAA"};
      let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const j = JSON.parse(s || "{}");
        for (const a of j.Answer || []) {
          const t = names[a.type] || ("TYPE" + a.type);
          if (t === want) console.log(`${a.name} ${a.TTL} ${t} ${a.data}`);
        }
      });' "$type"
  fi
}

fqdn() { [ "$1" = "@" ] && echo "$DOMAIN." || echo "$1.$DOMAIN."; }

{
  echo "# Public DNS snapshot for $DOMAIN"
  echo "# Taken (UTC): $(date -u '+%Y-%m-%d %H:%M:%S')  resolver: 1.1.1.1 ($MODE)"
  echo "# Format: <name> <TTL seconds> <type> <value>. CNAME answers for A/AAAA"
  echo "# queries are listed under CNAME only. Names with no records are listed at the end."
  echo
  empty=()
  for h in "${HOSTS[@]}"; do
    name="$(fqdn "$h")"; found=""
    for t in "${TYPES[@]}"; do
      # Skip A/AAAA/MX/TXT/CAA lookups on names that are a CNAME (they would
      # just repeat the target's records).
      if [ "$t" != CNAME ] && [ -n "${cname:-}" ]; then continue; fi
      r="$(query "$name" "$t" || true)"
      if [ "$t" = CNAME ]; then cname="$r"; fi
      if [ -n "$r" ]; then
        [ -z "$found" ] && echo "## $name"
        found=1; echo "$r"
      fi
    done
    unset cname
    if [ -z "$found" ]; then empty+=("$name"); else echo; fi
  done
  for h in "${SRV_HOSTS[@]}"; do
    name="$h.$DOMAIN."
    r="$(query "$name" SRV || true)"
    if [ -n "$r" ]; then echo "## $name"; echo "$r"; echo; else empty+=("$name (SRV)"); fi
  done
  echo "## SOA"
  query "$DOMAIN." SOA || true
  echo
  echo "## DNSSEC (DS = at the registry/Wix; DNSKEY = served by the current DNS host)"
  echo "## If a DS record is listed, DNSSEC is ON: disable it at the registrar and wait"
  echo "## out the DS TTL BEFORE changing nameservers, or the domain (incl. e-mail) breaks."
  ds="$(query "$DOMAIN." DS || true)"; [ -n "$ds" ] && echo "$ds" || echo "(no DS record: DNSSEC off)"
  query "$DOMAIN." DNSKEY | cut -c1-60 | sed "s/$/... (key truncated)/" || true
  echo
  echo "## No records found for:"
  for e in "${empty[@]}"; do echo "  $e"; done
} > "$OUT"

echo "wrote $OUT"
