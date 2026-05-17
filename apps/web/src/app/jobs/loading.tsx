export default function JobsLoading() {
  return (
    <div className="stack">
      <section className="hero">
        <div className="skeleton skeleton--label" />
        <div className="skeleton skeleton--hero" />
        <div className="skeleton skeleton--paragraph" />
        <div className="skeleton skeleton--paragraph skeleton--short" />
        <div className="hero__actions">
          <div className="skeleton skeleton--button" />
          <div className="skeleton skeleton--button" />
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
          <div className="job-table__toolbar">
            <div className="skeleton skeleton--input" />
            <div className="skeleton skeleton--input" />
            <div className="skeleton skeleton--input" />
          </div>
          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <div className="skeleton skeleton--table" />
          </div>
        </div>
      </section>
    </div>
  );
}
