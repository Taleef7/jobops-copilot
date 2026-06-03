export default function JobDetailLoading() {
  return (
    <div className="stack">
      <section className="hero">
        <div className="skeleton skeleton--label" />
        <div className="skeleton skeleton--hero" />
        <div className="skeleton skeleton--paragraph" />
        <div className="hero__actions">
          <div className="skeleton skeleton--button" />
          <div className="skeleton skeleton--button" />
        </div>
      </section>

      <div className="detail-grid">
        <section className="panel">
          <div className="panel__header">
            <div>
              <div className="skeleton skeleton--label" />
              <div className="skeleton skeleton--heading" />
            </div>
          </div>
          <div className="panel__body">
            <div className="stack">
              <div className="skeleton skeleton--block" />
              <div className="skeleton skeleton--block" />
              <div className="skeleton skeleton--block" />
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <div>
              <div className="skeleton skeleton--label" />
              <div className="skeleton skeleton--heading" />
            </div>
          </div>
          <div className="panel__body">
            <div className="stack">
              <div className="skeleton skeleton--input" />
              <div className="skeleton skeleton--input" />
              <div className="skeleton skeleton--input" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
