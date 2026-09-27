#!/bin/sh
# Install as /www/cgi-bin/momo-a-update (0755). Secrets live outside /www.
umask 077
fail() {
    logger -t momo-a-update "$1"
    printf 'Status: 502 Bad Gateway\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n{"error":"A update failed; existing cache retained"}\n'
    exit 0
}
case "$REMOTE_ADDR" in
    127.0.0.1|::1) ;;
    *) printf 'Status: 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nForbidden\n'; exit 0 ;;
esac
if [ "$REQUEST_METHOD" != GET ]; then
    printf 'Status: 405 Method Not Allowed\r\nAllow: GET\r\n\r\n'
    exit 0
fi
case "$QUERY_STRING" in
    ''|variant=full) converter=/etc/momo/local-feed/converter-a.curl ;;
    variant=simple) converter=/etc/momo/local-feed/converter-a-simple.curl ;;
    *) printf 'Status: 400 Bad Request\r\n\r\nUnknown variant\n'; exit 0 ;;
esac
work=$(mktemp -d /tmp/momo-a-update.XXXXXX) || fail 'temporary directory failed'
trap 'rm -f "$work/source.yaml" "$work/profile.json"; rmdir "$work"' EXIT
trap 'exit 1' HUP INT TERM

# Normal routing works without a dedicated proxy listener; SOCKS is a fallback
# while Momo is running. Cold starts can still use Momo's last good cache.
fetch_source() {
    curl --config /etc/momo/local-feed/source-a.curl "$@" \
        --silent --fail --location --connect-timeout 8 --max-time 20 \
        --max-filesize 4000000 --output "$work/source.yaml" 2>/dev/null &&
        grep -q '^proxies:' "$work/source.yaml"
}
if ! fetch_source; then
    fetch_source --proxy socks5h://127.0.0.1:10556 || fail 'upstream fetch failed'
fi
curl --config "$converter" \
    --silent --fail --connect-timeout 8 --max-time 40 \
    --header 'Content-Type: text/plain; charset=utf-8' \
    --data-binary "@$work/source.yaml" --output "$work/profile.json" \
    2>/dev/null || fail 'cloud conversion failed'
sing-box check -c "$work/profile.json" >/dev/null 2>&1 || fail 'core validation failed'
logger -t momo-a-update 'A fetched locally, converted and validated'
printf 'Content-Type: application/json\r\nCache-Control: no-store\r\n\r\n'
cat "$work/profile.json"
