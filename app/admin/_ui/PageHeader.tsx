/*
 * The top of every admin page: the way back (a "← …" link), the page's <h1>
 * and its one-line purpose, and the page's main actions on the right (they
 * wrap under the title on a phone). Children go under the title row: a
 * screen's own tabs or language picker.
 */
export function PageHeader({
  title,
  lede,
  back,
  actions,
  children,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  /** The way back, e.g. <Link href="/admin/content">← Nội dung</Link>. */
  back?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="a-pagehead">
      {back ? <p className="a-crumbs">{back}</p> : null}
      <div className="a-pagehead-row">
        <div className="a-pagehead-text">
          <h1>{title}</h1>
          {lede ? <p className="a-lede">{lede}</p> : null}
        </div>
        {actions ? <div className="a-pagehead-actions">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
