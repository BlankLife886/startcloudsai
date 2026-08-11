import "@legacy/components/profile/ProfileSectionShell.vue?react-style";

export function ProfileSectionShell({ title, description = "", actions, children }) {
  return (
    <div className="ps-shell">
      <header className="ps-hero">
        <div className="ps-hero__copy">
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="ps-hero__actions">{actions}</div>}
      </header>
      <section className="ps-board">{children}</section>
    </div>
  );
}
