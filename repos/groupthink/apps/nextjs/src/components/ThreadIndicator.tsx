"use client";

import Link from "next/link";

type ParentPost = {
  id: string;
  content: string;
  group: { id: string; name: string };
};

type ThreadIndicatorProps = {
  parentPost: ParentPost;
  depth?: number;
};

export function ThreadIndicator({ parentPost, depth = 0 }: ThreadIndicatorProps) {
  const clampedDepth = Math.min(depth, 4);

  return (
    <div
      className="thread-indicator"
      style={
        clampedDepth > 0
          ? ({ "--thread-depth": clampedDepth } as React.CSSProperties)
          : undefined
      }
    >
      <svg
        className="thread-icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M8 2v12M4 6l-2 2 2 2M12 6l2 2-2 2" />
      </svg>
      <div className="thread-context">
        <span className="thread-from">
          Replying to post in{" "}
          <Link href={`/groups/${parentPost.group.id}`} className="thread-group">
            {parentPost.group.name}
          </Link>
          {clampedDepth > 0 && (
            <span className="thread-depth-badge">
              depth {clampedDepth + 1}
            </span>
          )}
        </span>
        <p className="thread-preview">{parentPost.content}</p>
        <Link
          href={`/groups/${parentPost.group.id}`}
          className="thread-view-link"
        >
          View thread
        </Link>
      </div>
    </div>
  );
}
