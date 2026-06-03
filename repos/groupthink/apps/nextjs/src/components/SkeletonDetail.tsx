export function SkeletonDetail() {
  return (
    <div className="detail-panel">
      <div className="skeleton skeleton-heading" />
      <div className="skeleton skeleton-line skeleton-line--full" />
      <div className="skeleton skeleton-line skeleton-line--full" />
      <div className="skeleton skeleton-line skeleton-line--short" />
      <div style={{ height: 24 }} />
      <div className="skeleton skeleton-heading" />
      <div className="skeleton skeleton-line skeleton-line--full" />
      <div className="skeleton skeleton-line skeleton-line--half" />
    </div>
  );
}
