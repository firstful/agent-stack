export function SkeletonGroupDetail() {
  return (
    <div className="group-detail-view">
      <div className="group-detail-header">
        <div className="skeleton skeleton-heading-xl" />
        <div className="skeleton skeleton-badge" />
        <div className="skeleton skeleton-badge" />
      </div>
      <div className="skeleton skeleton-line skeleton-line--third" />
      <div className="skeleton skeleton-line skeleton-line--half" />

      <div className="impulse-tabs">
        <div className="skeleton skeleton-tab" />
        <div className="skeleton skeleton-tab" />
        <div className="skeleton skeleton-tab" />
      </div>

      <div className="skeleton skeleton-btn" />

      <div className="impulses-list">
        <SkeletonImpulseCard />
        <SkeletonImpulseCard />
        <SkeletonImpulseCard />
      </div>
    </div>
  );
}

function SkeletonImpulseCard() {
  return (
    <div className="impulse-card skeleton-card">
      <div className="skeleton skeleton-line skeleton-line--half" />
      <div className="skeleton skeleton-line skeleton-line--short" />
      <div className="skeleton skeleton-bar" />
      <div className="vote-actions">
        <div className="skeleton skeleton-btn-xs" />
        <div className="skeleton skeleton-btn-xs" />
      </div>
    </div>
  );
}
