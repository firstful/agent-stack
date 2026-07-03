# Grocery automation — undetectable browser framework
from .browser import (
    detect_display,
    run_on_display,
    profile_dir,
    screenshot_dir,
    session_state_path,
    get_launch_kwargs,
    get_persistent_launch_kwargs,
    get_context_kwargs,
    save_storage_state,
    SITE_CONFIGS,
    PROFILES_DIR,
)

from .stealth import (
    apply_stealth_js,
    human_delay,
    human_type,
    random_scroll,
)

__all__ = [
    "detect_display",
    "run_on_display",
    "profile_dir",
    "screenshot_dir",
    "session_state_path",
    "get_launch_kwargs",
    "get_persistent_launch_kwargs",
    "get_context_kwargs",
    "save_storage_state",
    "SITE_CONFIGS",
    "PROFILES_DIR",
    "apply_stealth_js",
    "human_delay",
    "human_type",
    "random_scroll",
]
