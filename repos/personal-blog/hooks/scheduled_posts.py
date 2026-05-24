import logging
import os
from datetime import date

log = logging.getLogger("mkdocs.hooks")

MODE = os.environ.get("MKDOCS_SCHEDULE_MODE", "0")


def on_page_markdown(markdown, page, config, files):
    pub_date = page.meta.get("date")
    today = date.today()

    if not (pub_date and isinstance(pub_date, date) and pub_date > today):
        return markdown

    if MODE == "1":
        banner = (
            f"\n\n> **Scheduled** — this post is set to publish on {pub_date}.\n"
            f"  It will appear automatically on the live site after that date.\n\n"
        )
        return banner + markdown

    log.info(f"Hiding future-dated post: {page.file.src_path} (publishes {pub_date})")
    page.meta["draft"] = True
    page.meta["search"] = {"exclude": True}
    return ""
