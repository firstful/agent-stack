export function SkeletonFeed() {
  return (
    <div className="feed-view">
      <header className="feed-header">
        <div className="skeleton skeleton-heading-lg" />
        <div className="skeleton skeleton-select" />
      </header>
      <div className="message-list">
        <SkeletonFeedCard />
        <SkeletonFeedCard />
        <SkeletonFeedCard />
      </div>
    </div>
  );
}

function SkeletonFeedCard() {
  return (
    <div className="message-card skeleton-card">
      <div className="message-header">
        <div className="skeleton skeleton-tag" />
        <div className="skeleton skeleton-tag-short" />
        <div className="skeleton skeleton-time" />
      </div>
      <div className="skeleton skeleton-line skeleton-line--full" />
      <div className="skeleton skeleton-line skeleton-line--half" />
      <div className="message-actions">
        <div className="skeleton skeleton-btn-xs" />
        <div className="skeleton skeleton-btn-xs" />
      </div>
    </div>
  );
}
