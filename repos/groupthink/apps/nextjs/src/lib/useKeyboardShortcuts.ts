"use client";

import { useEffect, useCallback, useState } from "react";

type FeedKeyboardOptions = {
  onEndorse?: () => void;
  onReply?: () => void;
  onViewPost?: () => void;
  onNewest?: () => void;
  onPopular?: () => void;
  onSearch?: () => void;
  activeIndex?: number;
  setActiveIndex?: (i: number) => void;
  maxIndex?: number;
  enabled?: boolean;
};

export function useFeedKeyboardShortcuts({
  onEndorse,
  onReply,
  onViewPost,
  onNewest,
  onPopular,
  onSearch,
  activeIndex = -1,
  setActiveIndex,
  maxIndex = 0,
  enabled = true,
}: FeedKeyboardOptions) {
  const [showHelp, setShowHelp] = useState(false);

  const toggleHelp = useCallback(() => {
    setShowHelp((prev) => !prev);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in inputs/textareas
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        // Navigation: j/k or up/down to move between posts
        case "j":
        case "ArrowDown":
          e.preventDefault();
          if (setActiveIndex && activeIndex < maxIndex - 1) {
            setActiveIndex(activeIndex + 1);
          }
          break;

        case "k":
        case "ArrowUp":
          e.preventDefault();
          if (setActiveIndex && activeIndex > 0) {
            setActiveIndex(activeIndex - 1);
          }
          break;

        // Endorse: e
        case "e":
          e.preventDefault();
          onEndorse?.();
          break;

        // Reply: r
        case "r":
          e.preventDefault();
          onReply?.();
          break;

        // View post detail: v
        case "v":
          e.preventDefault();
          onViewPost?.();
          break;

        // Sort: 1 for newest, 2 for popular
        case "1":
          e.preventDefault();
          onNewest?.();
          break;

        case "2":
          e.preventDefault();
          onPopular?.();
          break;

        // Search: /
        case "/":
          e.preventDefault();
          onSearch?.();
          break;

        // Toggle help: ?
        case "?":
          e.preventDefault();
          toggleHelp();
          break;
      }
    },
    [
      enabled,
      activeIndex,
      maxIndex,
      setActiveIndex,
      onEndorse,
      onReply,
      onViewPost,
      onNewest,
      onPopular,
      onSearch,
      toggleHelp,
    ]
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);

  return { showHelp, setShowHelp, toggleHelp };
}
