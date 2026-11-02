import { currentToken } from '../../lib/api';
import { assetUrl } from '../../lib/asset-url';

/**
 * Image backdrop for a panel: the banner fills it when there is one, otherwise
 * the panel's own colour fills it flat. A dark scrim keeps text and icons
 * legible over either, so anything layered on top uses `text-on-image` instead
 * of the theme's text colours.
 */
export function BannerBackdrop({
  imageUrl,
  color,
  scrim = 'strong',
}: {
  imageUrl: string | null;
  color: string;
  /** `strong` for compact panels, `soft` for lists, `card` for a 16:9 tile. */
  scrim?: 'strong' | 'soft' | 'card';
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0" style={{ backgroundColor: color }} />
      {imageUrl ? (
        <img src={assetUrl(imageUrl, { token: currentToken() })} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
      <div
        className={
          scrim === 'strong'
            ? 'absolute inset-0 bg-gradient-to-t from-black/75 via-black/55 to-black/40'
            : scrim === 'soft'
              ? 'absolute inset-0 bg-gradient-to-t from-black/70 via-black/45 to-black/25'
              : 'absolute inset-0 bg-gradient-to-t from-black/80 via-black/55 to-black/30'
        }
      />
    </div>
  );
}
