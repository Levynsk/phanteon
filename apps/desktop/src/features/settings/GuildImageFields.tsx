import { assetUrl } from '../../lib/asset-url';
import { ImagePlus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Avatar } from '../../components/ui/Avatar';
import { ImagePicker } from './ImagePicker';

interface GuildIconUploaderProps {
  name: string;
  iconUrl: string | null;
  iconColor: string;
  disabled: boolean;
  onFile: (file: File) => Promise<void>;
}

/** Round guild icon that sits half over the banner, with a hover-to-change overlay. */
export function GuildIconUploader({ name, iconUrl, iconColor, disabled, onFile }: GuildIconUploaderProps) {
  return (
    <div className="rounded-full outline outline-[5px] outline-app-alt">
      <ImagePicker
        label={disabled ? 'Sem permissão para alterar o ícone' : 'Alterar ícone do servidor'}
        disabled={disabled}
        onFile={onFile}
        className="size-20 rounded-full"
      >
        <Avatar name={name} src={iconUrl} color={iconColor} className="size-20 rounded-full text-2xl" />
      </ImagePicker>
    </div>
  );
}

interface GuildBannerUploaderProps {
  bannerUrl: string | null;
  color: string;
  disabled: boolean;
  onFile: (file: File) => Promise<void>;
}

/** Wide banner preview; empty state offers an explicit upload affordance. */
export function GuildBannerUploader({ bannerUrl, color, disabled, onFile }: GuildBannerUploaderProps) {
  return (
    <ImagePicker
      label={disabled ? 'Sem permissão para alterar o banner' : bannerUrl ? 'Alterar banner' : 'Enviar banner'}
      disabled={disabled}
      onFile={onFile}
      className="h-[130px] w-full overflow-hidden rounded-md"
      overlay={
        bannerUrl
          ? 'absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-sm bg-elevated/90 px-2.5 py-1.5 text-[12px] font-semibold text-heading opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'
          : 'absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-md text-[13px] font-medium text-normal transition-colors hover:bg-tint'
      }
    >
      {bannerUrl ? (
        <img src={assetUrl(bannerUrl)} alt="Banner do servidor" className="size-full object-cover" />
      ) : (
        <span
          className="flex size-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong"
          style={{ background: `linear-gradient(110deg, ${color}26, transparent 65%)` }}
        >
          <span className="flex items-center gap-2">
            <ImagePlus size={18} aria-hidden />
            Nenhum banner definido
          </span>
          <span className="text-[12px] text-muted">Enviar imagem</span>
        </span>
      )}
    </ImagePicker>
  );
}

/** 1:1 color swatches, which double as the avatar fallback color. */
export function GuildColorPicker({
  value,
  colors,
  disabled,
  onChange,
}: {
  value: string;
  colors: readonly string[];
  disabled: boolean;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor do ícone">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          disabled={disabled}
          onClick={() => onChange(color)}
          className={cn(
            'relative size-9 rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40',
            value === color && 'ring-2 ring-brand ring-offset-2 ring-offset-input',
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
