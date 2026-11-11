import { toExternalHref } from '../../lib/externalLink';

/** A stored link: clickable (new tab) when it is a real link, plain text otherwise, "—" when empty. */
export function ExternalLink({ value }: { value?: string | null }) {
  if (!value) return <>—</>;
  const href = toExternalHref(value);
  if (!href) return <>{value}</>;
  return (
    <a
      className="break-all font-semibold text-accent underline"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {value}
    </a>
  );
}
