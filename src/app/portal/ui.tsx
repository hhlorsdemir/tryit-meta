import type { ReactNode } from "react";

/** Çizgi ikonlar; renkleri currentColor'dan alır, ekran okuyucudan gizli. */
function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function StarIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" fill="currentColor" />
    </Svg>
  );
}

export function SparkIcon() {
  return (
    <Svg>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
    </Svg>
  );
}

export function AlertIcon() {
  return (
    <Svg>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17.5v.01" />
    </Svg>
  );
}

export function CheckIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </Svg>
  );
}

export function CloseIcon() {
  return (
    <Svg>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function ChevronIcon() {
  return (
    <Svg size={14}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function PhotoIcon() {
  return (
    <Svg size={28}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-8 8" />
    </Svg>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** Hata kutusu: renk dışında ikon ve metinle de anlatılır. */
export function Alert({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="alert" role="alert">
      <span className="alert-icon">
        <AlertIcon />
      </span>
      <div className="alert-body">
        <p>{message}</p>
        {action}
      </div>
    </div>
  );
}
