import type { User } from '@/store/authStore';

type AvatarUser = Pick<User, 'first_name' | 'last_name' | 'avatar'>;

interface AvatarProps {
  user: AvatarUser | null;
  size?: number;
  /** Corner radius class. The header/sidebar chips are squircles, not circles. */
  rounded?: string;
  className?: string;
}

/**
 * Profile photo with an initials fallback.
 *
 * `user.avatar` is resolved server-side (accounts/avatar.py): the uploaded
 * photo when there is one, otherwise the Google picture that came with the
 * school Gmail account at sign-in. So a family that has never opened the photo
 * picker still gets a real face here.
 *
 * Lives in ui/ rather than next to AvatarUpload so the header and sidebar can
 * render it without pulling the cropper + Modal into the layout chunk.
 */
export function Avatar({ user, size = 64, rounded = 'rounded-full', className = '' }: AvatarProps) {
  const initials = `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`.toUpperCase() || '?';
  if (user?.avatar) {
    return (
      <img
        src={user.avatar}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={`${rounded} flex-shrink-0 bg-cream-2 object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`${rounded} flex flex-shrink-0 items-center justify-center bg-gradient-to-br from-pink to-purple font-head font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

export default Avatar;
