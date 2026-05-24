#!/usr/bin/env bash
set -euo pipefail

BLOG_DIR="docs/blog"
CMD="${1:-status}"
TODAY=$(date +%Y-%m-%d)

status() {
    echo ""
    echo "Schedule status (today = $TODAY):"
    echo ""

    local scheduled=0 published=0
    while IFS= read -r -d '' file; do
        pub_date=$(grep -m1 "^date:" "$file" | sed 's/date: *//; s/^"//; s/"$//')
        if [[ -n "$pub_date" ]]; then
            if [[ "$pub_date" > "$TODAY" ]]; then
                echo "    🔒  ${file#$BLOG_DIR/}  ($pub_date)"
                ((scheduled++))
            else
                echo "    ✓  ${file#$BLOG_DIR/}  ($pub_date)"
                ((published++))
            fi
        fi
    done < <(find "$BLOG_DIR" -name "*.md" -not -name "*.md.scheduled" -print0)

    echo ""
    echo "  Total: $scheduled scheduled, $published published"
    echo ""
}

case "$CMD" in
    status)
        status
        ;;
    *)
        echo "Usage: $0 {status}"
        exit 1
        ;;
esac
